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
const declared = new Map<string, Array<{ id: string; version?: string }>>();
const declaredLookup = jest.fn(async (ids: readonly string[]) => new Map([...declared].filter(([k]) => ids.includes(k))));
jest.mock('../data/mcp-negotiation-repository', () => ({
    McpNegotiationRepository: jest.fn().mockImplementation(() => ({ extensionsByServerIds: declaredLookup })),
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

beforeEach(() => { rows.length = 0; statuses.length = 0; userClients.clear(); declared.clear(); declaredLookup.mockClear(); });

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

describe('GET /api/mcp/servers — 전송·엔드포인트 퇴역 안내 (MCP-3)', () => {
    const FLAG = 'MCP_TRANSPORT_DEPRECATION_NOTICES';
    afterEach(() => { delete process.env[FLAG]; });

    it('플래그 OFF 면 transportNotice 필드가 없다(응답 모양 불변)', async () => {
        rows.push(row({ id: 'mcp_sse', transport_type: 'sse', url: 'https://mcp.notion.com/sse' }));
        const res = await request(app).get('/api/mcp/servers');
        expect(res.body.data.servers[0]).not.toHaveProperty('transportNotice');
    });

    it('플래그 ON 이면 SSE·옮겨 가는 주소에만 안내를 싣고, SSE 연결 상태는 그대로다', async () => {
        process.env[FLAG] = 'true';
        rows.push(
            row({ id: 'mcp_sse', transport_type: 'sse', url: 'https://mcp.notion.com/sse' }),
            row({ id: 'mcp_atl', transport_type: 'streamable-http', url: 'https://mcp.atlassian.com/v1/mcp' }),
            row({ id: 'mcp_plain' }),
        );
        userClients.set('mcp_sse', { getStatus: () => ({ status: 'connected', toolCount: 3 }) });
        const res = await request(app).get('/api/mcp/servers');
        const byId = Object.fromEntries((res.body.data.servers as Array<{ id: string }>).map((s) => [s.id, s]));
        expect(byId.mcp_sse).toMatchObject({ connectionStatus: 'connected', toolCount: 3, transportNotice: { code: 'endpoint-sunset', sunsetDate: '2027-02-23' } });
        expect(byId.mcp_atl).toMatchObject({ transportNotice: { code: 'endpoint-moved', reauthRequired: true } });
        expect(byId.mcp_plain).not.toHaveProperty('transportNotice');
    });
});

describe('GET /api/mcp/servers — 선언 확장 (MCP-5)', () => {
    const FLAG = 'MCP_EXTENSION_AWARENESS';
    afterEach(() => { delete process.env[FLAG]; });

    it('플래그 OFF 면 declaredExtensions 필드가 없고 관측도 조회하지 않는다', async () => {
        rows.push(row({ id: 'mcp_apps' }));
        declared.set('mcp_apps', [{ id: 'io.modelcontextprotocol/ui' }]);
        const res = await request(app).get('/api/mcp/servers');
        expect(res.body.data.servers[0]).not.toHaveProperty('declaredExtensions');
        expect(declaredLookup).not.toHaveBeenCalled();
    });

    it('플래그 ON 이면 선언한 서버에만 분류를 싣고, 미선언 서버는 응답 모양이 그대로다', async () => {
        process.env[FLAG] = 'true';
        rows.push(row({ id: 'mcp_apps' }), row({ id: 'mcp_plain' }));
        declared.set('mcp_apps', [{ id: 'io.modelcontextprotocol/skills', version: '1' }, { id: 'io.modelcontextprotocol/ui' }]);
        const res = await request(app).get('/api/mcp/servers');
        const byId = Object.fromEntries((res.body.data.servers as Array<{ id: string; declaredExtensions?: unknown }>).map((s) => [s.id, s]));
        expect(byId.mcp_apps.declaredExtensions).toEqual([
            { id: 'io.modelcontextprotocol/skills', version: '1', kind: 'skills', support: 'unsupported' },
            { id: 'io.modelcontextprotocol/ui', kind: 'apps', support: 'unsupported' },
        ]);
        expect(byId.mcp_plain).not.toHaveProperty('declaredExtensions');
    });

    it('관측 조회가 실패해도 목록은 정상이고 필드만 빠진다(fail-open)', async () => {
        process.env[FLAG] = 'true';
        rows.push(row({ id: 'mcp_apps' }));
        declaredLookup.mockRejectedValueOnce(new Error('db down'));
        const res = await request(app).get('/api/mcp/servers');
        expect(res.status).toBe(200);
        expect(res.body.data.servers[0]).not.toHaveProperty('declaredExtensions');
    });
});
