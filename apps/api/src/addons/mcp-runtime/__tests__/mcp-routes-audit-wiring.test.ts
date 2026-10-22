/**
 * mcp.routes 감사 연결(S10) — 서버 등록·삭제 성공과 남의 서버 삭제(403)가 실제 라우트에서
 * auditSecurityEvent 를 한 번씩, 올바른 action 으로 부르는지 확인한다(헬퍼 단위 테스트는 mcp-server-audit.test).
 */
const registerServer = jest.fn(async (_config: unknown, _repo: unknown) => 'connected');
const unregisterServer = jest.fn(async (_id: string, _repo: unknown) => undefined);
const getServerById = jest.fn(async (_id: string): Promise<Record<string, unknown> | null> => null);
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'] };
        next();
    },
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../index', () => ({
    getUnifiedMCPClient: () => ({
        getServerRegistry: () => ({
            registerServer: (c: unknown, r: unknown) => registerServer(c, r),
            unregisterServer: (i: string, r: unknown) => unregisterServer(i, r),
        }),
    }),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../data/mcp-server-repository', () => ({ McpServerRepository: jest.fn() }));
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({ getServerById: (id: string) => getServerById(id) })),
}));
jest.mock('../data/mcp-oauth-repository', () => ({ McpOAuthRepository: jest.fn() }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => null }));
jest.mock('../sandbox-bootstrap', () => ({ removeSandboxCacheVolume: jest.fn(async () => false) }));
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
    isSsrfBlockedError: jest.requireActual('../../../security/security-audit').isSsrfBlockedError,
}));

import express from 'express';
import request from 'supertest';
import { mcpRouter } from '../routes/mcp.routes';
import { auditSecurityEvent } from '../../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;
const app = express();
app.use(express.json());
app.use('/api/mcp', mcpRouter);

beforeEach(() => jest.clearAllMocks());

describe('mcp.routes × 보안 감사 연결', () => {
    it('POST /servers 성공 → 서버 등록 뒤 mcp_server.create 1회', async () => {
        const res = await request(app).post('/api/mcp/servers').set('x-test-user', 'a-1').set('x-test-role', 'admin')
            .send({ name: 'files', transport_type: 'stdio', command: 'npx' });
        expect(res.status).toBe(201);
        expect(registerServer).toHaveBeenCalledTimes(1);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.create', userId: 'a-1', resourceType: 'mcp_server',
            resourceId: res.body.data.server.id, details: { name: 'files', source: 'manual' },
        });
        expect(audit.mock.invocationCallOrder[0]).toBeGreaterThan(registerServer.mock.invocationCallOrder[0]);
    });

    it('DELETE /servers/:id 성공 → mcp_server.delete 1회', async () => {
        getServerById.mockResolvedValueOnce({ id: 'mcp_1', name: 'git', user_id: 'u-1', visibility: 'user_private' });
        const res = await request(app).delete('/api/mcp/servers/mcp_1').set('x-test-user', 'u-1').set('x-test-role', 'user');
        expect(res.status).toBe(200);
        expect(unregisterServer).toHaveBeenCalledTimes(1);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.delete', userId: 'u-1', resourceType: 'mcp_server', resourceId: 'mcp_1', details: { name: 'git' },
        });
    });

    it('DELETE /servers/:id 남의 서버 → 403 + security.authz_denied(mcp_server) 1회', async () => {
        getServerById.mockResolvedValueOnce({ id: 'mcp_2', name: 'git', user_id: 'owner', visibility: 'user_private' });
        const res = await request(app).delete('/api/mcp/servers/mcp_2').set('x-test-user', 'other').set('x-test-role', 'user');
        expect(res.status).toBe(403);
        expect(unregisterServer).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'security.authz_denied', userId: 'other', resourceType: 'mcp_server', resourceId: 'mcp_2',
        });
    });
});
