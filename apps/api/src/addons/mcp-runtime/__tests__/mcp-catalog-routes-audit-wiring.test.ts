/**
 * mcp-catalog.routes 감사 연결(S10) — POST /servers/from-catalog 의 등록 성공·조직 정책 거부·가시성 거부(403)가
 * 실제 라우트에서 auditSecurityEvent 를 한 번씩, 올바른 action 으로 부르는지 확인한다(헬퍼 단위 테스트는 mcp-server-audit.test).
 */
const getCatalogTemplate = jest.fn(async (_id: string): Promise<Record<string, unknown> | null> => null);
const createFromCatalog = jest.fn(async (_payload: unknown, _template: unknown, _userId: string) => ({
    id: 'mcp_c1', name: 'files', auto_spawn: true,
}));
const resolveEffectivePolicy = jest.fn(async (_userId: string): Promise<{ mcpAllowedServers: string[] | null }> => ({
    mcpAllowedServers: null,
}));
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'] };
        next();
    },
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../../services/org/effective-policy', () => ({ resolveEffectivePolicy: (u: string) => resolveEffectivePolicy(u) }));
jest.mock('../index', () => ({ getUnifiedMCPClient: () => ({ getServerRegistry: () => ({}) }) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../data/mcp-server-repository', () => ({ McpServerRepository: jest.fn() }));
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({
        getCatalogTemplate: (id: string) => getCatalogTemplate(id),
        createFromCatalog: (p: unknown, t: unknown, u: string) => createFromCatalog(p, t, u),
        getServerById: jest.fn(async () => null),
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
import { mcpCatalogRouter } from '../routes/mcp-catalog.routes';
import { auditSecurityEvent } from '../../../security/security-audit';

const audit = auditSecurityEvent as jest.Mock;
const app = express();
app.use(express.json());
app.use('/api/mcp', mcpCatalogRouter);

const TEMPLATE = { id: 'filesystem', display_name: 'Filesystem', transport_type: 'stdio', args_schema: {}, env_schema: {}, is_enabled: true };

beforeEach(() => {
    jest.clearAllMocks();
    getCatalogTemplate.mockResolvedValue(TEMPLATE);
});

describe('mcp-catalog.routes × 보안 감사 연결', () => {
    it('POST /servers/from-catalog 성공 → 등록 뒤 mcp_server.create(source=catalog) 1회', async () => {
        const res = await request(app).post('/api/mcp/servers/from-catalog').set('x-test-user', 'u-1').set('x-test-role', 'user')
            .send({ template_id: 'filesystem', name: 'files' });
        expect(res.status).toBe(201);
        expect(createFromCatalog).toHaveBeenCalledTimes(1);
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.create', userId: 'u-1', resourceType: 'mcp_server',
            resourceId: 'mcp_c1', details: { name: 'files', source: 'catalog' },
        });
        expect(res.body.data.server.id).toBe('mcp_c1');
        expect(audit.mock.invocationCallOrder[0]).toBeGreaterThan(createFromCatalog.mock.invocationCallOrder[0]);
    });

    it('조직 허용 목록 밖 템플릿 → 403 + mcp_server.register_denied(org_policy) 1회, 등록 안 함', async () => {
        resolveEffectivePolicy.mockResolvedValueOnce({ mcpAllowedServers: ['other'] });
        const res = await request(app).post('/api/mcp/servers/from-catalog').set('x-test-user', 'u-1').set('x-test-role', 'user')
            .send({ template_id: 'filesystem', name: 'files' });
        expect(res.status).toBe(403);
        expect(createFromCatalog).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.register_denied', userId: 'u-1', resourceType: 'mcp_server',
            details: { reason: 'org_policy', templateId: 'filesystem' },
        });
    });

    it('일반 사용자의 global 등록 → 403 + mcp_server.register_denied(가시성 사유) 1회, 등록 안 함', async () => {
        const res = await request(app).post('/api/mcp/servers/from-catalog').set('x-test-user', 'u-1').set('x-test-role', 'user')
            .send({ template_id: 'filesystem', name: 'files', visibility: 'global' });
        expect(res.status).toBe(403);
        expect(createFromCatalog).not.toHaveBeenCalled();
        expect(audit).toHaveBeenCalledTimes(1);
        expect(audit.mock.calls[0][0]).toMatchObject({
            action: 'mcp_server.register_denied', userId: 'u-1', resourceType: 'mcp_server',
            details: { reason: 'global 서버는 admin 만 등록할 수 있습니다', templateId: 'filesystem', visibility: 'global' },
        });
    });

    it('없는 템플릿 → 404, 감사 없음', async () => {
        getCatalogTemplate.mockResolvedValueOnce(null);
        const res = await request(app).post('/api/mcp/servers/from-catalog').set('x-test-user', 'u-1').set('x-test-role', 'user')
            .send({ template_id: 'missing', name: 'files' });
        expect(res.status).toBe(404);
        expect(createFromCatalog).not.toHaveBeenCalled();
        expect(audit).not.toHaveBeenCalled();
    });
});
