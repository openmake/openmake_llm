/**
 * 관리자 연결 기기 조회·강제 해제 (2026-10-05). 관리자 전용.
 *   GET  /api/admin/local-bridge/devices                       — 연결된 전체 기기(사용자별)
 *   POST /api/admin/local-bridge/devices/:deviceId/disconnect  — body { userId }, 소켓 종료 + 감사 기록
 * deviceId 는 사용자 안에서만 유일하므로 해제는 userId 를 함께 받는다.
 * 기기 목록은 API 프로세스 메모리(레지스트리)에 있다 — 프로세스 1개 전제.
 * 응답에는 폴더의 전체 경로·키 값을 싣지 않는다(폴더는 마지막 경로 조각만).
 * @module routes/admin-local-bridge
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { AdminBridgeDevice, AdminBridgeDevicesResponse, AdminBridgeUserDevices } from '@openmake/shared-types';
import { requireAuth, requireAdmin } from '../auth/middleware';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound } from '../utils/api-response';
import { validate } from '../middlewares/validation';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { getAuditService } from '../services/AuditService';
import { LOCAL_BRIDGE } from '../config/local-bridge';
import { getLocalBridgeRegistry, LEGACY_BRIDGE_KINDS, type DeviceSession } from '../services/local-bridge/registry';

const disconnectSchema = z.object({ userId: z.string().trim().min(1).max(64) });

/** PURE: 폴더 표시값 — 기기가 전체 경로를 보냈더라도 마지막 조각만 남긴다. */
export function folderDisplayName(folderName: string): string {
    return folderName.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

function toDevice(s: DeviceSession): AdminBridgeDevice {
    const caps = s.capabilities ? [...s.capabilities] : [...LEGACY_BRIDGE_KINDS];
    return {
        deviceId: s.deviceId,
        hostId: s.hostId ?? s.deviceId,
        label: s.label,
        folderName: folderDisplayName(s.folderName),
        connectedAt: s.connectedAt,
        capabilities: caps.sort(),
    };
}

export const adminLocalBridgeRouter = Router();
adminLocalBridgeRouter.use('/local-bridge', requireAuth, requireAdmin);

adminLocalBridgeRouter.get('/local-bridge/devices', asyncHandler(async (_req: Request, res: Response) => {
    const sessions = LOCAL_BRIDGE.ENABLED ? getLocalBridgeRegistry().listAllDevices() : [];
    const byUser = new Map<string, DeviceSession[]>();
    for (const s of sessions) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);
    const db = getUnifiedDatabase();
    const users: AdminBridgeUserDevices[] = await Promise.all([...byUser.entries()].map(async ([userId, list]) => {
        const user = await db.getUserById(userId).catch(() => undefined);
        const devices = list.map(toDevice).sort((a, b) => a.hostId.localeCompare(b.hostId) || a.connectedAt - b.connectedAt);
        return { userId, email: user?.email ?? null, devices };
    }));
    const body: AdminBridgeDevicesResponse = { enabled: LOCAL_BRIDGE.ENABLED, users };
    res.json(success(body));
}));

adminLocalBridgeRouter.post('/local-bridge/devices/:deviceId/disconnect', validate(disconnectSchema), asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.body as z.infer<typeof disconnectSchema>;
    const deviceId = String(req.params.deviceId);
    if (!getLocalBridgeRegistry().disconnectDevice(userId, deviceId, 'admin_disconnect')) {
        res.status(404).json(notFound('연결된 기기'));
        return;
    }
    await getAuditService().logAudit({
        action: 'local_bridge.device_disconnect',
        userId: String(req.user!.id),
        resourceType: 'local_bridge_device',
        resourceId: `${userId}/${deviceId}`,
        details: { targetUserId: userId, deviceId },
    });
    res.json(success({ disconnected: true as const }));
}));
