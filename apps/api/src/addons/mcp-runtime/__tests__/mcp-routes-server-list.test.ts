/**
 * GET /api/mcp/servers — 서버마다 extension_id 와 modelExposure(모델에 노출되는 조건)를 싣는다.
 */
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 'u-1', role: 'user' }; next(); },
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const statuses: Array<{ serverId: string; status: string; toolCount: number }> = [];
jest.mock('../index', () => ({ getUnifiedMCPClient: () => ({ getServerRegistry: () => ({ getAllStatuses: () => statuses }) }) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
const rows: unknown[] = [];
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({
        listUserServers: async () => rows,
        getLatestConnectErrors: async () => new Map(),
    })),
}));
jest.mock('../data/mcp-oauth-repository', () => ({
    McpOAuthRepository: jest.fn().mockImplementation(() => ({ listConnectedServerIds: async () => new Set() })),
}));
const userClients = new Map<string, { getStatus: () => { status: string; toolCount: number } }>();
jest.mock('../lifecycle-supervisor', () => ({
    getLifecycleSupervisor: () => ({ getUserClient: (_u: string, id: string) => userClients.get(id) }),
}));
jest.mock('../sandbox-bootstrap', () => ({ removeSandboxCacheVolume: jest.fn(async () => false) }));
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));

import express from 'express';
import request from 'supertest';
import { mcpRouter } from '../routes/mcp.routes';

const app = express();
app.use('/api/mcp', mcpRouter);

const row = (over: Record<string, unknown>) => ({
    id: 'mcp_a', user_id: 'u-1', name: 'a', transport_type: 'stdio', visibility: 'user_private',
    enabled: true, auto_spawn: true, extension_id: null, env: null, ...over,
});

beforeEach(() => { rows.length = 0; statuses.length = 0; userClients.clear(); });

describe('GET /api/mcp/servers — 노출·확장 정보', () => {
    it('연결된 사용자 서버는 on_mention, 확장 설치분은 extension_id 를 싣는다', async () => {
        rows.push(row({ id: 'mcp_ext', extension_id: 'ext-1' }));
        userClients.set('mcp_ext', { getStatus: () => ({ status: 'connected', toolCount: 4 }) });
        const res = await request(app).get('/api/mcp/servers');
        expect(res.status).toBe(200);
        const s = res.body.data.servers[0];
        expect(s).toMatchObject({ id: 'mcp_ext', extension_id: 'ext-1', connectionStatus: 'connected', toolCount: 4 });
        expect(s.modelExposure).toMatchObject({ state: 'on_mention', viaMetaTools: true });
    });

    it('연결 안 된 서버·사용 안 함 서버는 none + 이유', async () => {
        rows.push(row({ id: 'mcp_off', enabled: false }), row({ id: 'mcp_down' }));
        const res = await request(app).get('/api/mcp/servers');
        const byId = Object.fromEntries((res.body.data.servers as Array<{ id: string; modelExposure: unknown }>).map((s) => [s.id, s.modelExposure]));
        expect(byId.mcp_off).toMatchObject({ state: 'none', reason: 'disabled' });
        expect(byId.mcp_down).toMatchObject({ state: 'none', reason: 'not_connected' });
    });

    it('전역 서버는 메타 도구로만 쓸 수 있다(on_demand)', async () => {
        rows.push(row({ id: 'mcp_g', user_id: null, visibility: 'global' }));
        statuses.push({ serverId: 'mcp_g', status: 'connected', toolCount: 2 });
        const res = await request(app).get('/api/mcp/servers');
        expect(res.body.data.servers[0].modelExposure).toMatchObject({ state: 'on_demand' });
    });
});
