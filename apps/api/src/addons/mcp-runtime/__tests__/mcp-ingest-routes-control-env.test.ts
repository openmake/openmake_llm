/**
 * git ingest draft 승인 라우트의 제어 env 거부(#1471 후속) — 저장될 env 에 제어 키가 있으면 기존 400 관례로 거부하고
 * 활성화·spawn·등록 감사를 하지 않는다. 응답에는 키 이름만 있고 값은 없다.
 */
const getById = jest.fn();
const approve = jest.fn();
const spawnUserServer = jest.fn();
jest.mock('../../../auth', () => ({
    requireAuth: async (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: req.headers['x-test-user'], role: 'user' };
        next();
    },
}));
jest.mock('../data/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({ getById: (...a: unknown[]) => getById(...a), approve: (...a: unknown[]) => approve(...a) })),
}));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ spawnUserServer: (...a: unknown[]) => spawnUserServer(...a) }) }));
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
    isSsrfBlockedError: () => false,
}));

import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { mcpServerIngestRouter } from '../routes/mcp-server-ingest.routes';
import { auditSecurityEvent } from '../../../security/security-audit';

const SECRET = `v-${Math.random().toString(36).slice(2)}`;
const app = express();
app.use(express.json());
app.use('/api/mcp/servers', mcpServerIngestRouter({ pool: {} as Pool, fetcherFactory: jest.fn() as never, llmClientFactory: jest.fn() as never }));
const draft = (env: Record<string, string>) => ({ id: 'd-1', user_id: 'u-1', status: 'draft', name: 'git-srv', manifest_meta: { requiredEnv: ['API_KEY'] }, env });
const post = (body: unknown) => request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'u-1').send(body as object);

beforeEach(() => {
    jest.clearAllMocks();
    approve.mockResolvedValue({ id: 'd-1', name: 'git-srv', user_id: 'u-1', enabled: true, auto_spawn: true });
});

describe('POST /:id/approve — 제어 env 거부', () => {
    it('override 의 제어 키(GIT_WORK_TREE)는 400, 활성화·spawn·등록 감사 없음, 값 미노출', async () => {
        getById.mockResolvedValue(draft({ API_KEY: 'k' }));
        const res = await post({ envOverrides: { GIT_WORK_TREE: SECRET } });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: 'INVALID_ENV_KEYS' });
        expect(JSON.stringify(res.body)).toContain('GIT_WORK_TREE');
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
        expect(approve).not.toHaveBeenCalled();
        expect(spawnUserServer).not.toHaveBeenCalled();
        expect(auditSecurityEvent).not.toHaveBeenCalled();
    });

    it('draft.env 의 제어 키(NODE_OPTIONS)는 필수 env 를 채워도 400', async () => {
        getById.mockResolvedValue(draft({ NODE_OPTIONS: SECRET }));
        const res = await post({ envOverrides: { API_KEY: 'real-key' } });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toContain('NODE_OPTIONS');
        expect(approve).not.toHaveBeenCalled();
    });

    it('GIT_TOKEN override 는 허용되어 종전대로 승인된다', async () => {
        getById.mockResolvedValue(draft({}));
        const res = await post({ envOverrides: { API_KEY: 'real-key', GIT_TOKEN: SECRET } });
        expect(res.status).toBe(200);
        expect(approve).toHaveBeenCalledWith(expect.objectContaining({ envOverrides: { API_KEY: 'real-key', GIT_TOKEN: SECRET } }));
    });
});
