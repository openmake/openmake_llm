/**
 * MCP-5 라우트 배선 — 카탈로그·서버 상태·관리자 협상 응답에 선언 확장을 싣는다(플래그 ON 일 때만).
 */
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 'u-1', role: 'admin' }; next(); },
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../index', () => ({ getUnifiedMCPClient: () => ({ getServerRegistry: () => ({ getServerStatus: () => undefined }) }) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({
        listCatalog: async () => [
            { id: 'tpl-apps', display_name: 'Apps', transport_type: 'streamable-http', url_template: 'https://x.invalid/mcp' },
            { id: 'tpl-plain', display_name: 'Plain', transport_type: 'stdio' },
        ],
        getServerById: async (id: string) => ({ id, name: id, user_id: 'u-1', visibility: 'user_private', transport_type: 'stdio' }),
    })),
}));
jest.mock('../data/mcp-negotiation-repository', () => ({
    McpNegotiationRepository: jest.fn().mockImplementation(() => ({
        extensionsByServerIds: async (ids: readonly string[]) =>
            new Map(ids.filter(id => id === 'mcp_tasks').map(id => [id, [{ id: 'io.modelcontextprotocol/tasks' }]])),
        extensionsByCatalogTemplateIds: async (ids: readonly string[]) =>
            new Map(ids.filter(id => id === 'tpl-apps').map(id => [id, [{ id: 'io.modelcontextprotocol/ui' }]])),
        list: async () => [
            { serverId: 'mcp_skill', extensions: [{ id: 'io.modelcontextprotocol/skills' }] },
            { serverId: 'mcp_none', extensions: [] },
        ],
    })),
}));
jest.mock('../data/mcp-admin-monitoring-repository', () => ({ McpAdminMonitoringRepository: jest.fn() }));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => null }));
jest.mock('../sandbox-bootstrap', () => ({ removeSandboxCacheVolume: jest.fn(async () => false) }));
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));

import express from 'express';
import request from 'supertest';
import { mcpCatalogRouter } from '../routes/mcp-catalog.routes';
import { mcpRouter } from '../routes/mcp.routes';
import { mcpAdminMonitoringRouter } from '../routes/mcp-admin-monitoring.routes';

const app = express();
app.use('/api/mcp', mcpCatalogRouter);
app.use('/api/mcp', mcpRouter);
app.use('/api/admin/mcp', mcpAdminMonitoringRouter);

const FLAG = 'MCP_EXTENSION_AWARENESS';
afterEach(() => { delete process.env[FLAG]; });

describe('플래그 OFF — 응답 모양 종전 그대로', () => {
    it('카탈로그·서버 상태·관리자 협상 어디에도 declaredExtensions 가 없다', async () => {
        const cat = await request(app).get('/api/mcp/catalog');
        expect(cat.status).toBe(200);
        for (const t of cat.body.data.templates) expect(t).not.toHaveProperty('declaredExtensions');
        const st = await request(app).get('/api/mcp/servers/mcp_tasks/status');
        expect(st.status).toBe(200);
        expect(st.body.data).not.toHaveProperty('declaredExtensions');
        const neg = await request(app).get('/api/admin/mcp/negotiation');
        for (const i of neg.body.data.items) expect(i).not.toHaveProperty('declaredExtensions');
    });
});

describe('플래그 ON', () => {
    beforeEach(() => { process.env[FLAG] = 'true'; });

    it('카탈로그 — 그 템플릿 설치 서버가 선언한 확장만, 미선언 템플릿은 필드 없음', async () => {
        const res = await request(app).get('/api/mcp/catalog');
        const byId = Object.fromEntries((res.body.data.templates as Array<{ id: string }>).map(t => [t.id, t]));
        expect(byId['tpl-apps']).toMatchObject({ declaredExtensions: [{ id: 'io.modelcontextprotocol/ui', kind: 'apps', support: 'unsupported' }] });
        expect(byId['tpl-plain']).not.toHaveProperty('declaredExtensions');
    });

    it('서버 상태 — 선언 서버만 분류가 붙는다', async () => {
        const res = await request(app).get('/api/mcp/servers/mcp_tasks/status');
        expect(res.body.data.declaredExtensions).toEqual([{ id: 'io.modelcontextprotocol/tasks', kind: 'tasks', support: 'unsupported' }]);
        expect(res.body.data.status).toMatchObject({ serverId: 'mcp_tasks', status: 'disconnected' });
        const plain = await request(app).get('/api/mcp/servers/mcp_plain/status');
        expect(plain.body.data).not.toHaveProperty('declaredExtensions');
    });

    it('관리자 협상 — 선언 항목에 분류, 빈 선언은 그대로', async () => {
        const res = await request(app).get('/api/admin/mcp/negotiation');
        const byId = Object.fromEntries((res.body.data.items as Array<{ serverId: string }>).map(i => [i.serverId, i]));
        expect(byId.mcp_skill).toMatchObject({ declaredExtensions: [{ kind: 'skills', support: 'unsupported' }] });
        expect(byId.mcp_none).not.toHaveProperty('declaredExtensions');
    });
});
