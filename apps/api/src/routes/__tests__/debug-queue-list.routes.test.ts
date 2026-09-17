/**
 * 디버그 큐 관리자 목록(F24.7 UI) — 관리자 게이트·limit 상한·reason 필터 전달.
 */
const listDebugCaptures = jest.fn(async (_o: unknown) => [{ id: 'd1', reason: 'user-report', hasReplayBundle: true }]);
jest.mock('../../auth', () => {
    const { requireAdmin } = jest.requireActual('../../auth/middleware');
    return {
        requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
            req.user = { id: '3', role: req.headers['x-test-role'] };
            next();
        },
        requireAdmin,
    };
});
jest.mock('../../data/conversation-debug-queue', () => ({
    enqueueDebugCapture: jest.fn(),
    getDebugCaptureForReplay: jest.fn(),
    DEBUG_QUEUE_TTL_MS: { 'auto-error': 1, 'user-report': 1 },
    listDebugCaptures: (o: unknown) => listDebugCaptures(o),
}));

import express from 'express';
import request from 'supertest';
import router from '../debug-queue.routes';
import { REPLAY_CAPTURE } from '../../config/runtime-limits';

const app = express();
app.use('/api/debug-queue', router);

beforeEach(() => listDebugCaptures.mockClear());

describe('GET /api/debug-queue', () => {
    it('관리자가 아니면 403 이고 조회하지 않는다', async () => {
        const res = await request(app).get('/api/debug-queue').set('x-test-role', 'user');
        expect(res.status).toBe(403);
        expect(listDebugCaptures).not.toHaveBeenCalled();
    });

    it('limit 은 상한으로 자르고 reason 은 허용 값만 전달한다', async () => {
        const res = await request(app).get('/api/debug-queue?limit=9999&reason=user-report').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        expect(res.body.data.items).toHaveLength(1);
        expect(listDebugCaptures).toHaveBeenCalledWith({ limit: REPLAY_CAPTURE.LIST_MAX, previewChars: REPLAY_CAPTURE.LIST_PREVIEW_CHARS, reason: 'user-report' });

        await request(app).get('/api/debug-queue?limit=5&reason=DROP').set('x-test-role', 'admin');
        expect(listDebugCaptures).toHaveBeenLastCalledWith({ limit: 5, previewChars: REPLAY_CAPTURE.LIST_PREVIEW_CHARS, reason: undefined });
    });
});
