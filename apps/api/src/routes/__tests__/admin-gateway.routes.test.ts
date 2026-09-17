/**
 * GET /api/admin/gateway/models (PR-14) — 관리자 게이트·게이트웨이 실패 시 200 {ok:false}·행 정렬 고정.
 */
const fetchInfo = jest.fn();
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
jest.mock('../../config', () => ({ getConfig: () => ({ llmBaseUrl: 'http://gw.test', llmApiKey: 'k', llmDefaultModel: 'qwen3.8-27b' }) }));
jest.mock('../../config/local-models-discovery', () => ({ fetchGatewayModelInfo: (...a: unknown[]) => fetchInfo(...a) }));
jest.mock('../../config/local-models', () => ({
    getLocalModels: () => [
        { id: 'qwen3.8-27b', role: 'chat', displayName: 'q', available: true },
        { id: 'bge-m3', role: 'embedding', displayName: 'b', available: false, unavailableReason: 'ping 실패' },
    ],
}));

import express from 'express';
import request from 'supertest';
import { adminGatewayRouter, summarizeGatewayModels } from '../admin-gateway.routes';

const app = express();
app.use('/api/admin', adminGatewayRouter);

describe('GET /api/admin/gateway/models', () => {
    beforeEach(() => fetchInfo.mockReset());

    it('관리자가 아니면 403 이고 게이트웨이를 조회하지 않는다', async () => {
        const res = await request(app).get('/api/admin/gateway/models').set('x-test-role', 'user');
        expect(res.status).toBe(403);
        expect(fetchInfo).not.toHaveBeenCalled();
    });

    it('게이트웨이 조회 실패는 502 가 아니라 200 {ok:false, reason}', async () => {
        fetchInfo.mockResolvedValue({ ok: false, reason: 'http://gw.test/model/info → 500' });
        const res = await request(app).get('/api/admin/gateway/models').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ ok: false, reason: 'http://gw.test/model/info → 500', defaultModel: 'qwen3.8-27b', models: [] });
    });

    it('성공 시 로컬 라우트가 먼저, 카탈로그 가용성·기본 모델 표시', async () => {
        fetchInfo.mockResolvedValue({
            ok: true,
            data: [
                { model_name: 'openrouter/*', litellm_params: { model: 'openrouter/*' } },
                { model_name: 'qwen3.8-27b', litellm_params: { model: 'hosted_vllm/qwen3.8-27b' }, model_info: { mode: 'chat' } },
                { model_name: 'bge-m3', litellm_params: { model: 'hosted_vllm/bge-m3' }, model_info: { mode: 'embedding' } },
            ],
        });
        const res = await request(app).get('/api/admin/gateway/models').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        expect(fetchInfo).toHaveBeenCalledWith('http://gw.test', 'k', expect.any(Number));
        const models = res.body.data.models as Array<Record<string, unknown>>;
        expect(models.map((m) => m.name)).toEqual(['bge-m3', 'qwen3.8-27b', 'openrouter/*']);
        expect(models[0]).toMatchObject({ local: true, available: false, unavailableReason: 'ping 실패', mode: 'embedding', isDefault: false });
        expect(models[1]).toMatchObject({ local: true, available: true, isDefault: true, upstream: 'hosted_vllm/qwen3.8-27b' });
        expect(models[2]).toMatchObject({ local: false, available: null, mode: null });
    });
});

describe('summarizeGatewayModels', () => {
    it('카탈로그에 없는 로컬 라우트는 available null, 이름 없는 항목은 버린다', () => {
        const rows = summarizeGatewayModels([{ model_name: 'new-local' }, { model_name: '' }], [], 'x');
        expect(rows).toEqual([{ name: 'new-local', upstream: null, mode: null, local: true, available: null, unavailableReason: null, isDefault: false }]);
    });
});
