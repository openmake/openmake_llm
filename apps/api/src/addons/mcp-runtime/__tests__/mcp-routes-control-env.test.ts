/**
 * 수동 등록 라우트(POST /api/mcp/servers)의 제어 env 거부(#1471 후속) — 실제 MCPServerRegistry 를 거쳐
 * DB 쓰기·spawn 전에 거부하고 기존 400(badRequest) 관례로 응답한다. 응답에는 키 이름만, 값은 없다.
 */
const createMcpServer = jest.fn(async () => ({}));
const clientCtor = jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined), getTools: jest.fn().mockReturnValue([]),
    disconnect: jest.fn().mockResolvedValue(undefined), getStatus: () => ({ serverId: 'mcp_1', serverName: 'srv', status: 'connected', toolCount: 0 }), callTool: jest.fn(),
}));
jest.mock('../external-client', () => ({ ExternalMCPClient: clientCtor }));
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 'a-1', role: 'admin' }; next(); },
    optionalAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
let registry: unknown;
jest.mock('../index', () => ({ getUnifiedMCPClient: () => ({ getServerRegistry: () => registry }) }));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../data/mcp-server-repository', () => ({ McpServerRepository: jest.fn().mockImplementation(() => ({ createMcpServer: (...a: unknown[]) => createMcpServer(...(a as [])) })) }));
jest.mock('../data/mcp-catalog-repository', () => ({ McpCatalogRepository: jest.fn() }));
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
import { MCPServerRegistry } from '../server-registry';
import { auditSecurityEvent } from '../../../security/security-audit';

const SECRET = `v-${Math.random().toString(36).slice(2)}`;
const app = express();
app.use(express.json());
app.use('/api/mcp', mcpRouter);

beforeEach(() => {
    jest.clearAllMocks();
    registry = new MCPServerRegistry({ registerExternalTools: jest.fn(), unregisterExternalTools: jest.fn() } as never);
});

describe('POST /api/mcp/servers — 제어 env 저장 거부', () => {
    it('env 에 GIT_DIR 이 있으면 400 이고 DB 쓰기·spawn·등록 감사가 없다(값 미노출)', async () => {
        const res = await request(app).post('/api/mcp/servers').send({ name: 'files', transport_type: 'stdio', command: 'npx', env: { GIT_DIR: SECRET, API_KEY: 'k' } });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: { code: 'BAD_REQUEST' } });
        expect(JSON.stringify(res.body)).toContain('GIT_DIR');
        expect(JSON.stringify(res.body)).not.toContain(SECRET);
        expect(createMcpServer).not.toHaveBeenCalled();
        expect(clientCtor).not.toHaveBeenCalled();
        expect(auditSecurityEvent).not.toHaveBeenCalled();
    });

    it('GIT_TOKEN 만 있으면 201 로 저장된다', async () => {
        const res = await request(app).post('/api/mcp/servers').send({ name: 'files', transport_type: 'stdio', command: 'npx', env: { GIT_TOKEN: SECRET } });
        expect(res.status).toBe(201);
        expect(createMcpServer).toHaveBeenCalledWith(expect.objectContaining({ env: { GIT_TOKEN: SECRET } }));
    });
});
