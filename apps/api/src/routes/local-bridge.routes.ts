/**
 * Local Bridge 상태 조회 (Cowork D2) — 컴포저 "로컬 실행" 토글의 활성 판단용.
 * GET /api/local-bridge/status → { enabled, connected, label }
 * @module routes/local-bridge
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../auth';
import { success } from '../utils/api-response';
import { LOCAL_BRIDGE } from '../config/local-bridge';
import { getLocalBridgeRegistry } from '../services/local-bridge/registry';

const router = Router();

router.get('/status', requireAuth, (req: Request, res: Response) => {
    const userId = String(req.user!.id);
    const dev = LOCAL_BRIDGE.ENABLED ? getLocalBridgeRegistry().getDevice(userId) : null;
    res.json(success({
        enabled: LOCAL_BRIDGE.ENABLED,
        connected: !!dev,
        label: dev?.label ?? null,
        folderName: dev?.folderName ?? null,
    }));
});

export default router;
