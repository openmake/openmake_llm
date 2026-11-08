/**
 * 관리자 bridge 허용 옵션 API(2026-11-08 점검 후속) — 사용자 소유 서버 목록·허용 토글.
 * 관리자 게이트는 실제 requireAdmin(상위 mcpAdminMonitoringRouter)으로 확인한다.
 */
const listUserOwned = jest.fn();
const setBridgeAllowed = jest.fn();
const getServerById = jest.fn();
const killUserServer = jest.fn(async (_u: string, _s: string) => undefined);
const emailsByIds = jest.fn(async (_ids: readonly string[]) => new Map<string, string>());
jest.mock('../../../auth', () => {
    const { requireAdmin } = jest.requireActual('../../../auth/middleware');
    return {
        requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
            req.user = { id: 'a-1', role: req.headers['x-test-role'] };
            next();
        },
        requireAdmin,
    };
});
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../../../runtime-ports/db-access', () => ({ getPool: () => ({}) }));
jest.mock('../../../runtime-ports/base-data-port', () => ({
    baseDataPort: { users: { emailsByIds: (ids: readonly string[]) => emailsByIds(ids) } },
}));
jest.mock('../data/mcp-admin-servers-repository', () => ({
    McpAdminServersRepository: jest.fn().mockImplementation(() => ({
        listUserOwned: (...a: unknown[]) => listUserOwned(...a),
        setBridgeAllowed: (...a: unknown[]) => setBridgeAllowed(...a),
    })),
}));
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({ getServerById: (id: string) => getServerById(id) })),
}));
jest.mock('../lifecycle-supervisor', () => ({
    getLifecycleSupervisor: () => ({ killUserServer: (u: string, s: string) => killUserServer(u, s) }),
}));
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
    auditHttpDenied: jest.fn(),
    isSsrfBlockedError: jest.requireActual('../../../security/security-audit').isSsrfBlockedError,
}));

import express from 'express';
import request from 'supertest';
import { mcpAdminMonitoringRouter } from '../routes/mcp-admin-monitoring.routes';
import { auditSecurityEvent } from '../../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;
const app = express();
app.use(express.json());
app.use('/api/admin/mcp', mcpAdminMonitoringRouter);

const row = (over: Record<string, unknown> = {}) => ({
    id: 'mcp_1', name: 'docs', transport_type: 'stdio', owner_user_id: 'u-5',
    sandbox_network: 'full', sandbox_bridge_allowed: false, enabled: true, created_at: '2026-11-08', ...over,
});
const server = (over: Record<string, unknown> = {}) => ({
    id: 'mcp_1', name: 'docs', transport_type: 'stdio', user_id: 'u-5', sandbox_network: 'full', sandbox_bridge_allowed: false, ...over,
});

const savedEgress = process.env.MCP_SANDBOX_USER_EGRESS;
beforeAll(() => { delete process.env.MCP_SANDBOX_USER_EGRESS; });
afterAll(() => { if (savedEgress !== undefined) process.env.MCP_SANDBOX_USER_EGRESS = savedEgress; });
beforeEach(() => jest.clearAllMocks());

describe('GET /api/admin/mcp/servers/user-owned', () => {
    it('비관리자 → 403', async () => {
        const res = await request(app).get('/api/admin/mcp/servers/user-owned').set('x-test-role', 'user');
        expect(res.status).toBe(403);
        expect(listUserOwned).not.toHaveBeenCalled();
    });

    it('effective_network 는 서버가 계산한다', async () => {
        listUserOwned.mockResolvedValue([
            row({ id: 'a' }),
            row({ id: 'b', sandbox_bridge_allowed: true }),
            row({ id: 'c', sandbox_network: 'none', sandbox_bridge_allowed: true }),
            row({ id: 'd', transport_type: 'streamable-http', sandbox_network: null }),
            row({ id: 'e', sandbox_network: null }),
        ]);
        const res = await request(app).get('/api/admin/mcp/servers/user-owned').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        const byId = Object.fromEntries((res.body.data.items as Array<{ id: string; effective_network: unknown }>).map((i) => [i.id, i.effective_network]));
        expect(byId).toEqual({ a: 'egress', b: 'bridge', c: 'none', d: null, e: 'egress' });
        expect(res.body.data.items[0]).toMatchObject({ sandbox_bridge_allowed: false, enabled: true });
        expect(listUserOwned).toHaveBeenCalledWith(500);
    });

    it('owner_email 은 Base 데이터 포트로 채운다 — 소유자 id 는 중복 없이 한 번에, 없으면 null', async () => {
        listUserOwned.mockResolvedValue([
            row({ id: 'a', owner_user_id: 'u-5' }),
            row({ id: 'b', owner_user_id: 'u-5' }),
            row({ id: 'c', owner_user_id: 'u-9' }),
        ]);
        emailsByIds.mockResolvedValueOnce(new Map([['u-5', 'u5@example.com']]));
        const res = await request(app).get('/api/admin/mcp/servers/user-owned').set('x-test-role', 'admin');
        expect(res.status).toBe(200);
        const byId = Object.fromEntries((res.body.data.items as Array<{ id: string; owner_email: unknown }>).map((i) => [i.id, i.owner_email]));
        expect(byId).toEqual({ a: 'u5@example.com', b: 'u5@example.com', c: null });
        expect(emailsByIds).toHaveBeenCalledTimes(1);
        expect(emailsByIds).toHaveBeenCalledWith(['u-5', 'u-9']);
    });
});

describe('PATCH /api/admin/mcp/servers/:id/sandbox-bridge', () => {
    const patch = (id: string, body: unknown, role = 'admin') =>
        request(app).patch(`/api/admin/mcp/servers/${id}/sandbox-bridge`).set('x-test-role', role).send(body as object);

    it('성공 → setBridgeAllowed·killUserServer·감사 1회·respawnRequired', async () => {
        getServerById.mockResolvedValue(server());
        setBridgeAllowed.mockResolvedValue(server({ sandbox_bridge_allowed: true }));
        const res = await patch('mcp_1', { allowed: true });
        expect(res.status).toBe(200);
        expect(setBridgeAllowed).toHaveBeenCalledWith('mcp_1', true);
        expect(killUserServer).toHaveBeenCalledWith('u-5', 'mcp_1');
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.sandbox_bridge_changed', userId: 'a-1', resourceType: 'mcp_server', resourceId: 'mcp_1',
            details: { name: 'docs', ownerUserId: 'u-5', allowed: true },
        });
        expect(res.body.data).toEqual({ server: { id: 'mcp_1', sandbox_bridge_allowed: true, effective_network: 'bridge' }, respawnRequired: true });
    });

    it('허용 해제 → effective_network egress', async () => {
        getServerById.mockResolvedValue(server({ sandbox_bridge_allowed: true }));
        setBridgeAllowed.mockResolvedValue(server({ sandbox_bridge_allowed: false }));
        const res = await patch('mcp_1', { allowed: false });
        expect(res.status).toBe(200);
        expect(res.body.data.server).toEqual({ id: 'mcp_1', sandbox_bridge_allowed: false, effective_network: 'egress' });
    });

    it('killUserServer 실패여도 변경은 유지(200)', async () => {
        getServerById.mockResolvedValue(server());
        setBridgeAllowed.mockResolvedValue(server({ sandbox_bridge_allowed: true }));
        killUserServer.mockRejectedValueOnce(new Error('x'));
        const res = await patch('mcp_1', { allowed: true });
        expect(res.status).toBe(200);
        expect(res.body.data.respawnRequired).toBe(true);
    });

    it('미존재 → 404', async () => {
        getServerById.mockResolvedValue(null);
        const res = await patch('mcp_x', { allowed: true });
        expect(res.status).toBe(404);
        expect(setBridgeAllowed).not.toHaveBeenCalled();
    });

    it('전역 서버 → 400', async () => {
        getServerById.mockResolvedValue(server({ user_id: null }));
        const res = await patch('mcp_1', { allowed: true });
        expect(res.status).toBe(400);
        expect(setBridgeAllowed).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
    });

    it('stdio 가 아닌 서버 → 400', async () => {
        getServerById.mockResolvedValue(server({ transport_type: 'sse' }));
        const res = await patch('mcp_1', { allowed: true });
        expect(res.status).toBe(400);
        expect(setBridgeAllowed).not.toHaveBeenCalled();
    });

    it.each([[{}], [{ allowed: 'yes' }], [{ allowed: 1 }]])('body 검증 실패 %j → 400', async (body) => {
        const res = await patch('mcp_1', body);
        expect(res.status).toBe(400);
        expect(getServerById).not.toHaveBeenCalled();
    });

    it('비관리자 → 403', async () => {
        const res = await patch('mcp_1', { allowed: true }, 'user');
        expect(res.status).toBe(403);
        expect(getServerById).not.toHaveBeenCalled();
    });
});
