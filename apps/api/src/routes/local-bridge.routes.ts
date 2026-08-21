/**
 * Local Bridge 상태 조회 (Cowork D2) — 컴포저 "로컬 실행" 토글의 활성 판단용.
 * GET /api/local-bridge/status → { enabled, connected, label }
 * @module routes/local-bridge
 */
import { Router, Request, Response } from 'express';
import { requireAuthOrApiKeyScope } from '../middlewares/api-key-auth';
import { API_KEY_SCOPES } from '../config/api-key-scopes';
import { success, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { LOCAL_BRIDGE } from '../config/local-bridge';
import { getLocalBridgeRegistry } from '../services/local-bridge/registry';

const router = Router();

router.get('/status', requireAuthOrApiKeyScope(API_KEY_SCOPES.BRIDGE), (req: Request, res: Response) => {
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

/**
 * GET /api/local-bridge/folders?deviceId=&path= — 연결 루트 하위 폴더 온디맨드 열거 (폴더 선택).
 * 디바이스가 스스로 열거한 상대경로만 응답하며, 서버는 그 목록을 세션 캐시에 병합해
 * 이후 folder 지정(작업 생성·bridge_exec)의 검증 근거로 쓴다. path 는 이전 응답의 에코만 허용.
 */
router.get('/folders', requireAuthOrApiKeyScope(API_KEY_SCOPES.BRIDGE), asyncHandler(async (req: Request, res: Response) => {
    if (!LOCAL_BRIDGE.ENABLED) {
        res.status(400).json(badRequest('로컬 실행 기능이 비활성화되어 있습니다 (LOCAL_EXECUTOR_ENABLED)'));
        return;
    }
    const userId = String(req.user!.id);
    const registry = getLocalBridgeRegistry();
    const deviceId = typeof req.query.deviceId === 'string' && req.query.deviceId ? req.query.deviceId : undefined;
    const dev = registry.getDevice(userId, deviceId);
    if (!dev) {
        res.status(400).json(badRequest('연결된 로컬 디바이스가 없습니다 — 데스크톱 앱 또는 CLI 로 작업 폴더를 먼저 연결하세요'));
        return;
    }
    const rel = typeof req.query.path === 'string' ? req.query.path : '';
    if (rel && !registry.isEnumeratedFolder(userId, dev.deviceId, rel)) {
        res.status(400).json(badRequest('디바이스가 보고하지 않은 경로입니다 — 루트부터 다시 탐색하세요'));
        return;
    }
    const r = await registry.request(userId, { kind: 'folders', ...(rel ? { path: rel } : {}) }, undefined, dev.deviceId);
    if (!r.ok) {
        // 구 디바이스(kind 미지원)·타임아웃 등 — 웹은 폴더 피커를 숨기고 루트 고정으로 동작.
        res.status(400).json(badRequest(r.error ?? '폴더 목록을 가져오지 못했습니다'));
        return;
    }
    const folders = (r.entries ?? []).filter((e) => typeof e === 'string' && e.length > 0);
    registry.noteEnumeratedFolders(userId, dev.deviceId, folders);
    res.json(success({
        deviceId: dev.deviceId,
        path: rel,
        folders: folders.map((relPath) => ({ rel: relPath, name: relPath.split('/').pop() ?? relPath })),
        truncated: !!r.truncated,
    }));
}));

export default router;
