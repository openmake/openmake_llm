/**
 * 확장 번들 원격 MCP 관리 등록(P8, opt-in EXTENSION_REMOTE_MCP_ENABLED) — 승인 전 연결 0.
 *
 * 종전에는 draft(승인 전) 서버도 수동 연결(`POST /servers/:id/connect` → supervisor.spawnUserServer)·OAuth 시작이
 * 상태를 보지 않아 띄울 수 있었다. 플래그 ON 이면 active 가 아닌 서버는 둘 다 거절한다. OFF 면 종전 그대로(상태 조회도 없음).
 */
const mockAuth = jest.fn();
jest.mock('@modelcontextprotocol/client', () => ({ auth: (...a: unknown[]) => mockAuth(...a) }));
const mockGetServerById = jest.fn();
const mockGetServerStatus = jest.fn();
jest.mock('../data/mcp-catalog-repository', () => ({
    McpCatalogRepository: jest.fn().mockImplementation(() => ({
        getServerById: (...a: unknown[]) => mockGetServerById(...a),
        getServerStatus: (...a: unknown[]) => mockGetServerStatus(...a),
    })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getUnifiedDatabase: () => ({ getPool: () => ({}) }) }));
jest.mock('../oauth-provider', () => ({
    McpOAuthProvider: jest.fn().mockImplementation(() => ({
        requestedScope: async () => undefined,
        capturedAuthorizationUrl: new URL('https://auth.example.com/authorize?x=1'),
    })),
    consumeMcpOAuthState: jest.fn(),
}));
jest.mock('../../../auth', () => ({
    requireAuth: (req: { user?: unknown }, _res: unknown, next: () => void) => { req.user = { id: 'u-1', role: 'user' }; next(); },
}));

import express from 'express';
import request from 'supertest';
import { mcpOAuthRouter } from '../routes/mcp-oauth.routes';
import { MCPLifecycleSupervisor } from '../lifecycle-supervisor';
import { UserMCPPool } from '../user-pool';
import { resetConfig } from '../../../config/env';

const ORIGINAL = process.env.EXTENSION_REMOTE_MCP_ENABLED;
function setFlag(on: boolean | undefined): void {
    if (on === undefined) delete process.env.EXTENSION_REMOTE_MCP_ENABLED;
    else process.env.EXTENSION_REMOTE_MCP_ENABLED = on ? 'true' : 'false';
    resetConfig();
}
afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_REMOTE_MCP_ENABLED;
    else process.env.EXTENSION_REMOTE_MCP_ENABLED = ORIGINAL;
    resetConfig();
});
beforeEach(() => jest.clearAllMocks());

const row = { id: 's-1', user_id: 'u-1', name: 'ext-cloud', transport_type: 'streamable-http', url: 'https://mcp.example.com/mcp', visibility: 'user_private', auto_spawn: false, enabled: false, command: null, args: [], env: {}, catalog_template_id: null, created_at: '', updated_at: '' };

function supervisorWith(status: string | null) {
    const repo = {
        listUserServers: jest.fn().mockResolvedValue([]),
        getServerById: jest.fn().mockResolvedValue(row),
        getServerStatus: jest.fn().mockResolvedValue(status),
        decryptEnvForSpawn: jest.fn().mockResolvedValue({}),
        recordInstanceTransition: jest.fn().mockResolvedValue(undefined),
        recordToolsRefreshed: jest.fn().mockResolvedValue(undefined),
        getCatalogToolAllowlist: jest.fn().mockResolvedValue(null),
        listAutoSpawnUserIds: jest.fn().mockResolvedValue([]),
        closeOrphanInstances: jest.fn().mockResolvedValue(0),
    };
    const factory = jest.fn().mockImplementation(() => ({
        connect: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn().mockResolvedValue(undefined),
        listTools: jest.fn().mockResolvedValue({ tools: [] }), callTool: jest.fn(), on: jest.fn(), getPid: jest.fn().mockReturnValue(1),
    }));
    return { sv: new MCPLifecycleSupervisor({ userPool: new UserMCPPool(), repo, clientFactory: factory as never }), repo, factory };
}

describe('supervisor.spawnUserServer — 승인 전 연결 차단', () => {
    it('플래그 OFF — 종전대로 draft 도 띄운다(상태 조회 없음)', async () => {
        setFlag(undefined);
        const { sv, repo, factory } = supervisorWith('draft');
        await sv.spawnUserServer('u-1', 's-1');
        expect(factory).toHaveBeenCalledTimes(1);
        expect(repo.getServerStatus).not.toHaveBeenCalled();
    });

    it.each(['draft', 'archived', null])('플래그 ON — %s 서버는 거절', async (status) => {
        setFlag(true);
        const { sv, factory } = supervisorWith(status);
        await expect(sv.spawnUserServer('u-1', 's-1')).rejects.toThrow(/^MCP_SERVER_NOT_APPROVED/);
        expect(factory).not.toHaveBeenCalled();
    });

    it('플래그 ON — active 서버는 띄운다', async () => {
        setFlag(true);
        const { sv, factory } = supervisorWith('active');
        await sv.spawnUserServer('u-1', 's-1');
        expect(factory).toHaveBeenCalledTimes(1);
    });
});

describe('POST /servers/:id/oauth/start — 승인 전 로그인 차단', () => {
    const app = express();
    app.use(express.json());
    app.use('/api/mcp', mcpOAuthRouter);

    beforeEach(() => {
        mockGetServerById.mockResolvedValue(row);
        mockAuth.mockResolvedValue('REDIRECT');
    });

    it('플래그 OFF — 종전대로 인가 URL 을 낸다(상태 조회 없음)', async () => {
        setFlag(undefined);
        mockGetServerStatus.mockResolvedValue('draft');
        const res = await request(app).post('/api/mcp/servers/s-1/oauth/start').send({});
        expect(res.status).toBe(200);
        expect(res.body.data.authorizationUrl).toContain('https://auth.example.com/authorize');
        expect(mockGetServerStatus).not.toHaveBeenCalled();
    });

    it('플래그 ON — draft 는 409 MCP_SERVER_NOT_APPROVED, 인가 흐름을 시작하지 않는다', async () => {
        setFlag(true);
        mockGetServerStatus.mockResolvedValue('draft');
        const res = await request(app).post('/api/mcp/servers/s-1/oauth/start').send({});
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('MCP_SERVER_NOT_APPROVED');
        expect(mockAuth).not.toHaveBeenCalled();
    });

    it('플래그 ON — active 는 인가 URL', async () => {
        setFlag(true);
        mockGetServerStatus.mockResolvedValue('active');
        const res = await request(app).post('/api/mcp/servers/s-1/oauth/start').send({});
        expect(res.status).toBe(200);
        expect(res.body.data.authorized).toBe(false);
    });

    it('플래그 ON 이어도 로그아웃(DELETE)은 상태와 무관 — 승인 전 서버의 토큰도 지울 수 있다', async () => {
        setFlag(true);
        mockGetServerStatus.mockResolvedValue('archived');
        // 저장소는 이 테스트의 대상이 아니다 — 409 가 아니면 된다
        const res = await request(app).delete('/api/mcp/servers/s-1/oauth');
        expect(res.status).not.toBe(409);
        expect(mockGetServerStatus).not.toHaveBeenCalled();
    });
});
