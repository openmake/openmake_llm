/**
 * mcp-server-ingest.routes 감사 연결(#1475) — git ingest draft 승인(활성화)은 mcp_server.create(source git_ingest),
 * 남의 draft 승인·거절(403)은 security.authz_denied 를 한 번씩 남긴다. 응답 코드·본문은 그대로이고
 * 감사 기록이 실패해도 응답은 바뀌지 않으며 unhandled rejection 이 생기지 않는다. env 값은 감사에 싣지 않는다.
 */
const getById = jest.fn();
const approve = jest.fn();
const reject = jest.fn();
jest.mock('../../../auth', () => ({
    requireAuth: async (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'] };
        next();
    },
}));
jest.mock('../data/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({
        getById: (...a: unknown[]) => getById(...a), approve: (...a: unknown[]) => approve(...a), reject: (...a: unknown[]) => reject(...a),
    })),
}));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => null }));
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
    isSsrfBlockedError: jest.requireActual('../../../security/security-audit').isSsrfBlockedError,
}));

import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { mcpServerIngestRouter } from '../routes/mcp-server-ingest.routes';
import { auditSecurityEvent } from '../../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;
const SECRET = `sk-${Math.random().toString(36).slice(2)}`;
const app = express();
app.use(express.json());
app.use('/api/mcp/servers', mcpServerIngestRouter({ pool: {} as Pool, fetcherFactory: jest.fn() as never, llmClientFactory: jest.fn() as never }));
const draft = { id: 'd-1', user_id: 'owner-1', status: 'draft', name: 'git-srv', manifest_meta: { requiredEnv: ['API_KEY'] }, env: {} };
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

let unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
beforeAll(() => process.on('unhandledRejection', onUnhandled));
afterAll(() => process.off('unhandledRejection', onUnhandled));
beforeEach(() => {
    jest.clearAllMocks(); unhandled = [];
    audit.mockResolvedValue(undefined);
    getById.mockResolvedValue(draft);
    approve.mockResolvedValue({ id: 'd-1', name: 'git-srv', user_id: 'owner-1', enabled: true, auto_spawn: false });
    reject.mockResolvedValue({ id: 'd-1', status: 'archived' });
});

describe('mcp-server-ingest.routes × 보안 감사 연결', () => {
    it('POST /:id/approve 성공 → 응답 그대로, mcp_server.create(source git_ingest) 1회, env 값 없음', async () => {
        const res = await request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'owner-1').set('x-test-role', 'user')
            .send({ envOverrides: { API_KEY: SECRET } });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { id: 'd-1' }, spawned: false });
        await flush();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.create', userId: 'owner-1', resourceType: 'mcp_server', resourceId: 'd-1',
            details: { name: 'git-srv', source: 'git_ingest' },
        });
        expect(JSON.stringify(audit.mock.calls)).not.toContain(SECRET);
    });

    it('POST /:id/approve 남의 draft → 403 FORBIDDEN 그대로, security.authz_denied 1회, 승인 안 함', async () => {
        const res = await request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'other-2').set('x-test-role', 'user').send({});
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ success: false, error: 'FORBIDDEN' });
        await flush();
        expect(approve).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'security.authz_denied', userId: 'other-2', resourceType: 'mcp_server', resourceId: 'd-1', details: { op: 'ingest_approve' },
        });
    });

    it('POST /:id/reject 남의 draft → 403 그대로, security.authz_denied 1회', async () => {
        const res = await request(app).post('/api/mcp/servers/d-1/reject').set('x-test-user', 'other-2').set('x-test-role', 'user').send({});
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ success: false, error: 'FORBIDDEN' });
        await flush();
        expect(reject).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({ action: 'security.authz_denied', resourceId: 'd-1', details: { op: 'ingest_reject' } });
    });

    it('검증 실패(422)·없는 draft(404)는 감사하지 않는다', async () => {
        const r1 = await request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'owner-1').set('x-test-role', 'user').send({});
        expect(r1.status).toBe(422);
        getById.mockResolvedValue(null);
        const r2 = await request(app).post('/api/mcp/servers/d-9/approve').set('x-test-user', 'owner-1').set('x-test-role', 'user').send({});
        expect(r2.status).toBe(404);
        await flush();
        expect(audit).not.toHaveBeenCalled();
    });

    it('감사 기록이 실패해도 승인 200·거부 403 응답은 그대로이고 unhandled rejection 이 없다', async () => {
        audit.mockRejectedValue(new Error('db down'));
        const ok = await request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'owner-1').set('x-test-role', 'user')
            .send({ envOverrides: { API_KEY: SECRET } });
        const denied = await request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'other-2').set('x-test-role', 'user').send({});
        await flush();
        expect(ok.status).toBe(200);
        expect(denied.status).toBe(403);
        expect(denied.body).toEqual({ success: false, error: 'FORBIDDEN' });
        expect(unhandled).toEqual([]);
    });
});
