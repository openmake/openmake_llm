/**
 * 확장 번들 원격 MCP 관리 등록(P8, opt-in EXTENSION_REMOTE_MCP_ENABLED) — 승인 단계(mcp-server-ingest.routes).
 *
 *  - 플래그 OFF: 종전 그대로(검사 없음, 승인 즉시 연결 시도, 응답에 oauthRequired 없음)
 *  - 플래그 ON: 저장 URL 이 선언값과 다르면 409, SSRF·호스트 확인 실패면 400, §8-3 MCP 서버 정책(실제 게이트) 거절은 403 — 모두 승인 안 함.
 *    통과하면 활성화하되 연결은 하지 않고 `oauthRequired: true`(OAuth 콜백이 연결한다)
 */
const getById = jest.fn();
const approve = jest.fn();
const spawnUserServer = jest.fn();
jest.mock('../../../auth', () => ({
    requireAuth: async (req: { user?: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
        req.user = { id: req.headers['x-test-user'], role: 'user' };
        next();
    },
}));
jest.mock('../data/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({
        getById: (...a: unknown[]) => getById(...a), approve: (...a: unknown[]) => approve(...a),
    })),
}));
jest.mock('../lifecycle-supervisor', () => ({ getLifecycleSupervisor: () => ({ spawnUserServer }) }));
const logAudit = jest.fn(async (_e: unknown) => undefined);
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: (e: unknown) => logAudit(e) }) }));
// §8-3 정책의 조직 층 — 기본 없음, 실패 주입 가능
const resolveEffectivePolicyStrict = jest.fn(async () => ({ extensionMcpServer: undefined as unknown }));
jest.mock('../../../services/org/effective-policy', () => ({
    ...jest.requireActual('../../../services/org/effective-policy'),
    resolveEffectivePolicyStrict: () => resolveEffectivePolicyStrict(),
}));
jest.mock('../../../security/security-audit', () => ({
    auditSecurityEvent: jest.fn().mockResolvedValue(undefined),
    isSsrfBlockedError: jest.requireActual('../../../security/security-audit').isSsrfBlockedError,
}));
const mockValidate = jest.fn(async (raw: string) => {
    const u = new URL(raw);
    if (u.hostname.startsWith('internal.')) throw new Error('SSRF blocked: resolved to blocked IP range: 10.0.0.5');
    if (u.hostname.startsWith('offline.')) throw new Error(`getaddrinfo ENOTFOUND ${u.hostname}`);
    return u;
});
jest.mock('../../../security/ssrf-guard', () => ({
    ...jest.requireActual('../../../security/ssrf-guard'),
    validateOutboundUrl: (raw: string) => mockValidate(raw),
}));

import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { mcpServerIngestRouter } from '../routes/mcp-server-ingest.routes';
import { resetConfig } from '../../../config/env';
import { buildRemoteRegistrationMeta } from '../../../services/extensions/remote-mcp-registration';
import { resetExtensionMcpServerPolicyState } from '../../../services/extensions/mcp-server-policy';

const app = express();
app.use(express.json());
app.use('/api/mcp/servers', mcpServerIngestRouter({ pool: {} as Pool, fetcherFactory: jest.fn() as never, llmClientFactory: jest.fn() as never }));

const URL_OK = 'https://mcp.example.com/mcp';
function remoteDraft(over: Record<string, unknown> = {}) {
    return {
        id: 'd-1', user_id: 'owner-1', status: 'draft', name: 'ext-cloud', transport_type: 'streamable-http', url: URL_OK,
        command: null, args: null, env: {},
        manifest_meta: { source: 'extension', extensionName: 'ext', serverKey: 'cloud', gitUrl: 'https://github.com/o/r', ...buildRemoteRegistrationMeta(URL_OK) },
        ...over,
    };
}
const ENV_KEYS = ['EXTENSION_REMOTE_MCP_ENABLED', 'EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY'] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
function setServerPolicy(policy: object | undefined): void {
    if (policy === undefined) { delete process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED; delete process.env.EXTENSION_MCP_SERVER_POLICY; }
    else { process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED = 'true'; process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify(policy); }
    resetConfig();
}
function setFlag(on: boolean | undefined): void {
    if (on === undefined) delete process.env.EXTENSION_REMOTE_MCP_ENABLED;
    else process.env.EXTENSION_REMOTE_MCP_ENABLED = on ? 'true' : 'false';
    resetConfig();
}
const post = () => request(app).post('/api/mcp/servers/d-1/approve').set('x-test-user', 'owner-1').send({});

beforeEach(() => {
    jest.clearAllMocks();
    approve.mockResolvedValue({ id: 'd-1', name: 'ext-cloud', user_id: 'owner-1', enabled: true, auto_spawn: true });
    spawnUserServer.mockResolvedValue({});
});
afterEach(() => {
    setServerPolicy(undefined);
    resetExtensionMcpServerPolicyState();
    resolveEffectivePolicyStrict.mockImplementation(async () => ({ extensionMcpServer: undefined }));
});
afterAll(() => {
    for (const k of ENV_KEYS) { if (ORIGINAL_ENV[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL_ENV[k]; }
    resetConfig();
});

describe('POST /:id/approve — 플래그 OFF(기본)', () => {
    it('종전 그대로 — 검사 없이 승인하고 곧바로 연결을 시도, oauthRequired 없음', async () => {
        setFlag(undefined);
        getById.mockResolvedValue(remoteDraft({ url: 'https://internal.corp/mcp' }));
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: expect.objectContaining({ id: 'd-1' }), spawned: true });
        expect(spawnUserServer).toHaveBeenCalledWith('owner-1', 'd-1');
        expect(mockValidate).not.toHaveBeenCalled();
    });
});

describe('POST /:id/approve — 플래그 ON', () => {
    beforeEach(() => setFlag(true));

    it('통과 — 활성화하되 연결하지 않고 oauthRequired', async () => {
        getById.mockResolvedValue(remoteDraft());
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, spawned: false, oauthRequired: true });
        expect(approve).toHaveBeenCalledTimes(1);
        expect(spawnUserServer).not.toHaveBeenCalled();
        expect(mockValidate).toHaveBeenCalledWith(URL_OK);
    });

    it('저장 URL 이 선언값과 다르면 409 MCP_REMOTE_URL_MISMATCH, 승인 안 함', async () => {
        getById.mockResolvedValue(remoteDraft({ url: 'https://evil.example.net/mcp' }));
        const res = await post();
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('MCP_REMOTE_URL_MISMATCH');
        expect(approve).not.toHaveBeenCalled();
    });

    it.each([
        ['https://internal.corp/mcp', 'MCP_REMOTE_URL_BLOCKED'],
        ['https://offline.example.com/mcp', 'MCP_REMOTE_URL_UNRESOLVED'],
        ['http://mcp.example.com/mcp', 'MCP_REMOTE_URL_INSECURE'],
    ])('%s → 400 %s, 승인·연결 안 함', async (url, code) => {
        getById.mockResolvedValue(remoteDraft({ url, manifest_meta: { source: 'extension', ...buildRemoteRegistrationMeta(url) } }));
        const res = await post();
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(code);
        expect(approve).not.toHaveBeenCalled();
        expect(spawnUserServer).not.toHaveBeenCalled();
    });

    it('§8-3 정책 거절 → 403 EXTENSION_MCP_SERVER_BLOCKED, 승인·연결 없음, 감사 origin=extension-approve', async () => {
        setServerPolicy({ deny: [{ type: 'url', url: 'https://mcp.example.com' }] });
        getById.mockResolvedValue(remoteDraft());
        const res = await post();
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('EXTENSION_MCP_SERVER_BLOCKED');
        expect(approve).not.toHaveBeenCalled();
        expect(spawnUserServer).not.toHaveBeenCalled();
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
            action: 'extension.mcp_server_blocked', details: expect.objectContaining({ origin: 'extension-approve', reason: 'DENIED' }),
        }));
    });

    it('§8-3 정책 허용 목록 안이면 승인(OAuth 뒤 연결)', async () => {
        setServerPolicy({ allow: [{ type: 'url', url: 'https://mcp.example.com' }] });
        getById.mockResolvedValue(remoteDraft());
        const res = await post();
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ spawned: false, oauthRequired: true });
    });

    it('§8-3 정책 조회 실패(적용 이력 없음) → fail-closed 403', async () => {
        setServerPolicy({ deny: [] });
        resolveEffectivePolicyStrict.mockImplementation(async () => { throw new Error('db down'); });
        getById.mockResolvedValue(remoteDraft());
        const res = await post();
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('EXTENSION_MCP_SERVER_BLOCKED');
        expect(approve).not.toHaveBeenCalled();
    });

    it('§8-3 정책 강제 OFF 면 정책 값이 있어도 승인(종전 동작)', async () => {
        process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify({ deny: [{ type: 'url', url: 'https://mcp.example.com' }] });
        resetConfig();
        getById.mockResolvedValue(remoteDraft());
        const res = await post();
        expect(res.status).toBe(200);
        expect(logAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'extension.mcp_server_blocked' }));
    });

    it('플래그 전 설치분(관리 기록 없음)도 SSRF 를 다시 보고 OAuth 뒤로 연결을 미룬다', async () => {
        getById.mockResolvedValue(remoteDraft({ manifest_meta: { source: 'extension' } }));
        const res = await post();
        expect(res.body).toMatchObject({ spawned: false, oauthRequired: true });
    });

    it('stdio·확장 아닌 원격 draft 는 종전 흐름(검사 없음, 승인 즉시 연결)', async () => {
        getById.mockResolvedValue(remoteDraft({ transport_type: 'stdio', url: null, command: 'npx', manifest_meta: { source: 'extension' } }));
        let res = await post();
        expect(res.body).toEqual({ success: true, data: expect.any(Object), spawned: true });
        getById.mockResolvedValue(remoteDraft({ manifest_meta: { source: 'git_ingest' } }));
        res = await post();
        expect(res.body.spawned).toBe(true);
        expect(mockValidate).not.toHaveBeenCalled();
    });
});
