/**
 * 확장 MCP 서버 정책(§8-3) 배선 — 확장 번들 설치(collectMcpDrafts)와 관리자 정책 미리보기(M3).
 *
 * 계약:
 *   - 강제 OFF: 정책이 저장돼 있어도 종전과 결과·경고·호출이 같다.
 *   - 강제 ON: 위반 서버는 관례 검사(LLM)·저장(insertDraft) **전에** 빠지고 나머지 구성요소는 설치된다(서버 단위 거절).
 *     위반 서버의 저장이 없으니 승인·spawn·연결도 생길 수 없다.
 *   - 정책을 확인하지 못하면(조직 조회 실패·적용 이력 없음) 모든 서버를 거절(fail-closed).
 *   - 미리보기 = 실제 거절 결과(같은 판정 함수, 설치 때 저장한 연결 설정 그대로).
 */
const insertDraft = jest.fn();
const listLinkedConnections = jest.fn();
jest.mock('../../../addon-host/addon-data', () => ({
    getComponentStore: () => ({
        insertDraft: (...a: unknown[]) => insertDraft(...a),
        findIdByUserAndName: async () => null,
        listLinked: async () => [],
        listLinkedConnections: (...a: unknown[]) => listLinkedConnections(...a),
    }),
}));
const checkMcpServer = jest.fn(async () => ({ findings: [], tokensUsed: 0 }));
jest.mock('../convention-checker', () => ({
    ConventionChecker: jest.fn().mockImplementation(() => ({ checkMcpServer: (...a: unknown[]) => (checkMcpServer as jest.Mock)(...a) })),
    isBlockedByConvention: () => false,
}));
const resolveEffectivePolicyStrict = jest.fn();
jest.mock('../../../services/org/effective-policy', () => ({
    ...jest.requireActual('../../../services/org/effective-policy'),
    resolveEffectivePolicyStrict: (...a: unknown[]) => resolveEffectivePolicyStrict(...a),
}));
const logAudit = jest.fn(async () => undefined);
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit }) }));
const listActiveForPreview = jest.fn();
jest.mock('../../../data/repositories/extension-inventory-repository', () => ({
    ...jest.requireActual('../../../data/repositories/extension-inventory-repository'),
    ExtensionInventoryRepository: jest.fn().mockImplementation(() => ({ listActiveForPreview: (...a: unknown[]) => listActiveForPreview(...a) })),
}));

import type { Pool } from 'pg';
import { resetConfig } from '../../../config/env';
import { collectMcpDrafts, type ComponentContext } from '../extension-components';
import type { LLMClient } from '../../../llm/client';
import type { NormalizedMcpServer } from '../extension-manifest-validator';
import { resetExtensionMcpServerPolicyState } from '../../../services/extensions/mcp-server-policy';
import { resetExtensionSourcePolicyState } from '../../../services/extensions/source-policy';
import { previewExtensionSourcePolicy } from '../../../services/extensions/inventory';
import { parseExtensionMcpServerPolicy } from '../../../config/extension-mcp-server-policy';

const KEYS = ['EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY', 'EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_SOURCE_POLICY'] as const;
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
    resetExtensionSourcePolicyState();
});
beforeEach(() => {
    jest.clearAllMocks();
    insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
    resolveEffectivePolicyStrict.mockResolvedValue({ extensionMcpServer: undefined });
});

const SERVERS: NormalizedMcpServer[] = [
    { name: 'fs', transportType: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem@1.0.0'] },
    { name: 'evil', transportType: 'stdio', command: 'sh', args: ['-c', 'npx -y evil-pkg'] },
    { name: 'cloud', transportType: 'streamable-http', url: 'https://mcp.example.com/v1' },
    { name: 'shady', transportType: 'streamable-http', url: 'https://SHADY.example.org:8443/x/' },
] as NormalizedMcpServer[];

const POLICY = JSON.stringify({
    allow: [
        { type: 'command', command: 'npx', package: '@modelcontextprotocol/*' },
        { type: 'command', command: 'sh' },
        { type: 'url', url: 'https://mcp.example.com' },
        { type: 'url', url: 'https://shady.example.org:8443' },
    ],
    deny: [{ type: 'command', command: 'npx', package: 'evil-pkg' }],
});
const ORG_LAYER = parseExtensionMcpServerPolicy({ deny: [{ type: 'url', url: 'https://shady.example.org' }] }, 'organization');

function ctx(): ComponentContext {
    return {
        pool: {} as never,
        fetcher: {} as never, owner: 'o', repo: 'r', sha: 's',
        tree: { entries: [] } as never, root: '',
        userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/o/r',
        manifestPath: 'plugin.json', extensionName: 'ext', warnings: [],
    };
}
const llm = (() => ({})) as unknown as (model: string) => LLMClient;

async function run() {
    const c = ctx();
    const res = await collectMcpDrafts(c, SERVERS, llm);
    return { res, warnings: c.warnings, inserted: insertDraft.mock.calls.map((x) => x[0].name as string), checked: checkMcpServer.mock.calls.length };
}

describe('collectMcpDrafts × MCP 서버 정책', () => {
    it('강제 OFF — 정책이 저장돼 있어도 종전과 결과·경고·호출이 같다', async () => {
        setEnv({});
        const baseline = await run();
        jest.clearAllMocks();
        insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
        setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'false', EXTENSION_MCP_SERVER_POLICY: '{"allow":[]}' });
        resolveEffectivePolicyStrict.mockResolvedValue({ extensionMcpServer: ORG_LAYER });
        const off = await run();
        expect(JSON.stringify(off)).toBe(JSON.stringify(baseline));
        expect(off.inserted).toHaveLength(4);
        expect(resolveEffectivePolicyStrict).not.toHaveBeenCalled();
        expect(logAudit).not.toHaveBeenCalled();
    });

    it('강제 ON — 위반 서버만 LLM 검사·저장 전에 빠지고 나머지는 설치된다', async () => {
        setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true', EXTENSION_MCP_SERVER_POLICY: POLICY });
        resolveEffectivePolicyStrict.mockResolvedValue({ extensionMcpServer: ORG_LAYER });
        const on = await run();
        expect(on.inserted).toEqual(['ext-fs', 'ext-cloud']);
        expect(on.checked).toBe(2);                                // 위반 서버엔 관례 검사(LLM)도 없다
        expect(on.res.find((r) => r.name === 'evil')).toMatchObject({ error: expect.stringMatching(/^EXTENSION_MCP_SERVER_BLOCKED: 차단 규칙/) });
        expect(on.res.find((r) => r.name === 'shady')?.error).toContain('조직 정책');
        expect(on.warnings.filter((w) => w.startsWith('MCP_SERVER_POLICY_BLOCKED:'))).toHaveLength(2);
        expect(logAudit).toHaveBeenCalledTimes(2);
        expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension.mcp_server_blocked', details: expect.objectContaining({ origin: 'extension-install', reason: 'DENIED' }) }));
    });

    it('정책 조회 실패 + 적용 이력 없음 = 모든 서버 거절(fail-closed), 저장·LLM 0회', async () => {
        setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true' });
        resolveEffectivePolicyStrict.mockRejectedValue(new Error('db down'));
        const on = await run();
        expect(on.inserted).toEqual([]);
        expect(on.checked).toBe(0);
        expect(on.res.every((r) => r.error?.includes('확인하지 못해'))).toBe(true);
    });
});

describe('정책 미리보기(M3) = 실제 거절 결과', () => {
    it('설치 때 저장한 연결 설정으로 같은 서버를 막는다(강제 OFF 에서도 force)', async () => {
        // 1) 강제 OFF 로 설치 — 저장된 값이 미리보기의 입력이 된다
        setEnv({ EXTENSION_MCP_SERVER_POLICY: POLICY });
        await run();
        const stored = insertDraft.mock.calls.map((x) => x[0] as { name: string; transportType: string; command: string | null; args: string[] | null; url: string | null });
        listLinkedConnections.mockResolvedValue(stored.map((s, i) => ({ id: `m${i}`, extensionId: 'e1', name: s.name, transport: s.transportType, command: s.command, args: s.args, url: s.url })));
        listActiveForPreview.mockResolvedValue([{ id: 'e1', user_id: 'u1', username: 'alice', name: 'ext', source_url: 'https://github.com/o/r', tracking_ref: null }]);
        resolveEffectivePolicyStrict.mockResolvedValue({ extensionMcpServer: ORG_LAYER, extensionSource: undefined });

        const preview = await previewExtensionSourcePolicy({} as Pool);
        expect(preview.mcpServers.enforced).toBe(false);
        expect(preview.mcpServers.checked).toBe(4);
        // 기존 응답 필드는 그대로
        expect(preview).toMatchObject({ enforced: false, checked: 1, blocked: [], truncated: false });

        // 2) 같은 정책으로 강제를 켜고 다시 설치 — 실제로 빠진 서버와 미리보기 차단이 같다
        jest.clearAllMocks();
        insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
        setEnv({ EXTENSION_MCP_SERVER_POLICY_ENFORCED: 'true', EXTENSION_MCP_SERVER_POLICY: POLICY });
        resolveEffectivePolicyStrict.mockResolvedValue({ extensionMcpServer: ORG_LAYER });
        const on = await run();
        const actually = on.res.filter((r) => r.error).map((r) => `ext-${r.name}`).sort();
        expect(preview.mcpServers.blocked.map((b) => b.server.name).sort()).toEqual(actually);
        for (const b of preview.mcpServers.blocked) {
            const installErr = on.res.find((r) => `ext-${r.name}` === b.server.name)!.error!;
            expect(installErr).toContain(b.verdict.server);
            expect(b.verdict.reason).toBe('DENIED');
        }
    });

    it('MCP 저장 연산에 연결 설정 읽기가 없으면 unavailable — 원본 미리보기는 그대로', async () => {
        setEnv({});
        listLinkedConnections.mockRejectedValue(new Error('표 없음'));
        listActiveForPreview.mockResolvedValue([{ id: 'e1', user_id: 'u1', username: 'alice', name: 'ext', source_url: 'https://github.com/o/r', tracking_ref: null }]);
        resolveEffectivePolicyStrict.mockResolvedValue({});
        const preview = await previewExtensionSourcePolicy({} as Pool);
        expect(preview.mcpServers).toEqual({ enforced: false, checked: 0, blocked: [], unavailable: true });
        expect(preview.checked).toBe(1);
    });
});
