/**
 * Local Bridge 상태 조회 (Cowork D2) — 컴포저 "로컬 실행" 토글의 활성 판단용.
 * GET /api/local-bridge/status → { enabled, connected, label }
 * @module routes/local-bridge
 */
import { Router, Request, Response } from 'express';
import { requireAuthOrApiKey } from '../middlewares/api-key-auth';
import { success } from '../utils/api-response';
import { LOCAL_BRIDGE } from '../config/local-bridge';
import { getLocalBridgeRegistry } from '../services/local-bridge/registry';

const router = Router();

router.get('/status', requireAuthOrApiKey, (req: Request, res: Response) => {
    const userId = String(req.user!.id);
    const devices = LOCAL_BRIDGE.ENABLED ? getLocalBridgeRegistry().getDevices(userId) : [];
    // 구 필드(connected/label/folderName)는 최근 접속 디바이스 기준으로 병존 — 구 프론트 무중단.
    const latest = LOCAL_BRIDGE.ENABLED ? getLocalBridgeRegistry().getDevice(userId) : null;
    res.json(success({
        enabled: LOCAL_BRIDGE.ENABLED,
        connected: !!latest,
        label: latest?.label ?? null,
        folderName: latest?.folderName ?? null,
        devices: devices.map((d) => ({
            deviceId: d.deviceId,
            label: d.label,
            folderName: d.folderName,
            connectedAt: d.connectedAt,
        })),
    }));
});

export default router;
