/**
 * 재현 라우트(F24.7) — 관리자만, 번들 없는 항목 404, 리플레이는 저장 응답과 비교해 돌려준다.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

let role = 'admin';
jest.mock('../../auth', () => ({
    requireAuth: (req: Request, _res: Response, next: NextFunction) => { (req as any).user = { id: '1', role }; next(); },
    requireAdmin: (req: Request, res: Response, next: NextFunction) => ((req as any).user?.role === 'admin' ? next() : res.status(403).json({ error: 'forbidden' })),
}));
const getDebugCaptureForReplay = jest.fn();
jest.mock('../../data/conversation-debug-queue', () => ({ enqueueDebugCapture: jest.fn(), DEBUG_QUEUE_TTL_MS: { 'user-report': 1 }, getDebugCaptureForReplay: (id: string) => getDebugCaptureForReplay(id) }));
const runReplay = jest.fn();
jest.mock('../../services/replay/replay-runner', () => ({ runReplay: (...a: unknown[]) => runReplay(...a) }));

import router from '../debug-queue.routes';

const app = () => { const a = express(); a.use(express.json()); a.use('/api/debug-queue', router); return a; };
const row = { id: 'dq-1', reason: 'auto-error', userMessage: 'q', assistantMessage: '저장된 답', requestId: 'req-1', replayBundle: { provider: { providerId: 'local-llm' }, messages: [] } };

beforeEach(() => { jest.clearAllMocks(); role = 'admin'; });

describe('재현 라우트', () => {
    it('관리자가 아니면 403', async () => {
        role = 'user';
        expect((await request(app()).get('/api/debug-queue/dq-1/replay-bundle')).status).toBe(403);
        expect(getDebugCaptureForReplay).not.toHaveBeenCalled();
    });

    it('번들 없는 항목·없는 항목은 404, 있으면 번들 반환', async () => {
        getDebugCaptureForReplay.mockResolvedValueOnce(null);
        expect((await request(app()).get('/api/debug-queue/x/replay-bundle')).status).toBe(404);
        getDebugCaptureForReplay.mockResolvedValueOnce({ ...row, replayBundle: null });
        expect((await request(app()).get('/api/debug-queue/dq-1/replay-bundle')).status).toBe(404);
        getDebugCaptureForReplay.mockResolvedValueOnce(row);
        const r = await request(app()).get('/api/debug-queue/dq-1/replay-bundle');
        expect(r.status).toBe(200);
        expect(r.body.data.requestId).toBe('req-1');
    });

    it('리플레이는 저장 응답을 기대값으로 넘기고, 러너 오류(외부 번들 모델 미지정)는 400', async () => {
        getDebugCaptureForReplay.mockResolvedValue(row);
        runReplay.mockResolvedValueOnce({ model: 'm', content: 'c', durationMs: 5, similarity: 0.8, toolCalls: [] });
        const ok = await request(app()).post('/api/debug-queue/dq-1/replay').send({ temperature: 0 });
        expect(ok.status).toBe(200);
        expect(runReplay).toHaveBeenCalledWith(row.replayBundle, { model: undefined, temperature: 0, expected: '저장된 답' });
        runReplay.mockRejectedValueOnce(new Error('model 을 지정해야 합니다'));
        expect((await request(app()).post('/api/debug-queue/dq-1/replay').send({})).status).toBe(400);
    });
});
