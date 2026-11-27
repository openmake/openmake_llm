/**
 * POST /servers/from-catalog × 확장 MCP 서버 정책(§8-3) — 강제 ON 이면 저장·즉시 spawn 전에, 저장될 값과 같은 렌더 결과로 판정.
 * 강제 OFF 면 렌더·정책 조회를 하지 않는다(입력 오류 문구·순서가 종전 그대로).
 */
const getCatalogTemplate = jest.fn(async (_id: string): Promise<Record<string, unknown> | null> => null);
const createFromCatalog = jest.fn(async (_payload: unknown, _template: unknown, _userId: string) => ({
    id: 'mcp_c1', name: 'files', auto_spawn: true, transport_type: 'stdio', url: null,
}));
const spawnUserServer = jest.fn(async () => undefined);
const resolveEffectivePolicyStrict = jest.fn(async (_u: string) => ({ extensionMcpServer: undefined }));
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: req.headers['x-test-user'], role: req.headers['x-test-role'] };
        next();
    },
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../../services/org/effective-policy', () => ({
    resolveEffectivePolicy: async () => ({ mcpAllowedServers: null }),
    resolveEffectivePolicyStrict: (u: string) => resolveEffectivePolicyStrict(u),
}));
jest.mock('../index', () => ({ getUnifiedMCPClient: () => ({ getServerRegistry: () => ({}) }) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../data/mcp-server-repository', () => ({ McpServerRepository: jest.fn() }));
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({
        getCatalogTemplate: (id: string) => getCatalogTemplate(id),
        createFromCatalog: (p: unknown, t: unknown, u: string) => createFromCatalog(p, t, u),
    })),
}));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ spawnUserServer }) }));
const logAudit = jest.fn(async () => undefined);
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
    isSsrfBlockedError: jest.requireActual('../../../security/security-audit').isSsrfBlockedError,
}));
const renderArgsSpy = jest.fn();
jest.mock('../data/mcp-catalog-helpers', () => {
    const actual = jest.requireActual('../data/mcp-catalog-helpers');
    return { ...actual, renderArgs: (...a: unknown[]) => { renderArgsSpy(); return actual.renderArgs(...a); } };
});

import express from 'express';
import request from 'supertest';
import { mcpCatalogRouter } from '../routes/mcp-catalog.routes';
import { errorHandler } from '../../../utils/error-handler';
import { resetConfig } from '../../../config/env';
import { resetExtensionMcpServerPolicyState } from '../../../services/extensions/mcp-server-policy';

const app = express();
app.use(express.json());
app.use('/api/mcp', mcpCatalogRouter);
app.use(errorHandler);

const STDIO = { id: 'evil', display_name: 'Evil', transport_type: 'stdio', command_template: 'npx -y evil-pkg@1.0.0', args_schema: {}, env_schema: {}, is_enabled: true };
const REMOTE = { id: 'remote', display_name: 'R', transport_type: 'streamable-http', url_template: 'https://mcp.example.com/{tenant}/mcp', args_schema: { properties: { tenant: {} } }, env_schema: {}, is_enabled: true };

const KEYS = ['EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
function setEnv(vars: Partial<Record<typeof KEYS[number], string>>) {
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    resetConfig();
}
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionMcpServerPolicyState();
    jest.clearAllMocks();
});
const post = (body: Record<string, unknown>) => request(app).post('/api/mcp/servers/from-catalog').set('x-test-user', 'u-1').set('x-test-role', 'user').send(body);

it('강제 OFF — 정책이 있어도 렌더·정책 조회 없이 종전대로 등록·spawn', async () => {
    setEnv({ EXTENSION_MCP_SERVER_POLICY: '{"allow":[]}' });
    getCatalogTemplate.mockResolvedValue(STDIO);
    const res = await post({ template_id: 'evil', name: 'files' });
    expect(res.status).toBe(201);
    expect(createFromCatalog).toHaveBeenCalledTimes(1);
    expect(spawnUserServer).toHaveBeenCalledTimes(1);
    expect(renderArgsSpy).not.toHaveBeenCalled();
    expect(resolveEffectivePolicyStrict).not.toHaveBeenCalled();
});

it('강제 ON + 차단 = 403 EXTENSION_MCP_SERVER_BLOCKED, 저장·spawn 0회, 감사 1회', async () => {
    setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true', EXTENSION_MCP_SERVER_POLICY: JSON.stringify({ deny: [{ type: 'command', command: 'npx', package: 'evil-pkg' }] }) });
    getCatalogTemplate.mockResolvedValue(STDIO);
    const res = await post({ template_id: 'evil', name: 'files' });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toContain('EXTENSION_MCP_SERVER_BLOCKED');
    expect(createFromCatalog).not.toHaveBeenCalled();
    expect(spawnUserServer).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension.mcp_server_blocked', details: expect.objectContaining({ origin: 'catalog' }) }));
});

it('강제 ON — 원격 URL 은 사용자 인자를 넣어 렌더한 값으로 판정(허용 목록)', async () => {
    setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true', EXTENSION_MCP_SERVER_POLICY: JSON.stringify({ allow: [{ type: 'url', url: 'https://mcp.example.com/acme' }] }) });
    getCatalogTemplate.mockResolvedValue(REMOTE);
    expect((await post({ template_id: 'remote', name: 'a', args: { tenant: 'acme' } })).status).toBe(201);
    const blocked = await post({ template_id: 'remote', name: 'b', args: { tenant: 'other' } });
    expect(blocked.status).toBe(403);
    expect(createFromCatalog).toHaveBeenCalledTimes(1);
});

it('강제 ON + 정책 조회 실패(이력 없음) = 거절', async () => {
    setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true' });
    resolveEffectivePolicyStrict.mockRejectedValueOnce(new Error('db down'));
    getCatalogTemplate.mockResolvedValue(STDIO);
    const res = await post({ template_id: 'evil', name: 'files' });
    expect(res.status).toBe(403);
    expect(createFromCatalog).not.toHaveBeenCalled();
});

it('강제 ON — 잘못된 입력은 종전과 같은 400(정책 판정 전 검증)', async () => {
    setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true' });
    getCatalogTemplate.mockResolvedValue(STDIO);
    const res = await post({ template_id: 'evil', name: 'files', args: { nope: 'x' } });
    expect(res.status).toBe(400);
    expect(createFromCatalog).not.toHaveBeenCalled();
});
