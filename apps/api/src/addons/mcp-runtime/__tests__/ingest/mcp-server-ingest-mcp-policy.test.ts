/**
 * import_mcp_server_from_git 도 확장 MCP 서버 정책(§8-3, Base)을 관례 검사(LLM)·저장 **전에** 지난다.
 * 서버 하나짜리 설치라 위반 = 설치 거절(403). 강제 OFF 면 종전대로.
 */
import { resetConfig } from '../../../../config/env';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../../llm/client';
import type { GitFetcher } from '../../../../agents/git-ingest/git-fetcher';
import { ExtensionMcpServerBlockedError } from '../../../../errors/extension-mcp-server-blocked.error';
import { resetExtensionMcpServerPolicyState } from '../../../../services/extensions/mcp-server-policy';

const insertDraft = jest.fn(async () => ({ id: 'srv1', name: 'evil', status: 'draft', manifest_meta: {} }));
jest.mock('../../data/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({
        insertDraft: (...a: unknown[]) => (insertDraft as jest.Mock)(...a),
        findRecentDraftByHash: async () => null,
        countDraftsForUser: async () => 0,
    })),
}));
const checkMcpServer = jest.fn(async () => ({ findings: [], tokensUsed: 0 }));
jest.mock('../../../../agents/git-ingest/convention-checker', () => ({
    ConventionChecker: jest.fn().mockImplementation(() => ({ checkMcpServer: (...a: unknown[]) => (checkMcpServer as jest.Mock)(...a) })),
    isBlockedByConvention: () => false,
}));
jest.mock('../../ingest/mcp-server-manifest-validator', () => ({
    parseMcpServerFile: () => ({}),
    validateMcpServerManifest: async () => ({
        ok: true, raw_yaml: '', body: '',
        manifest: { name: 'evil', description: 'd', category: 'c', version: '1', transport_type: 'stdio', command: 'npx', args: ['-y', 'evil-pkg'] },
    }),
}));
jest.mock('../../../../services/org/effective-policy', () => ({
    resolveEffectivePolicyStrict: jest.fn(async () => ({ extensionSource: undefined, extensionMcpServer: undefined })),
}));
jest.mock('../../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));
jest.mock('../../../../config/constants', () => ({
    ...jest.requireActual('../../../../config/constants'),
    MCP_INGEST: { ...jest.requireActual('../../../../config/constants').MCP_INGEST, enabled: true },
}));

import { McpServerIngestService } from '../../ingest/mcp-server-ingest-service';

const KEYS = ['EXTENSION_MCP_SERVER_POLICY_ENFORCED', 'EXTENSION_MCP_SERVER_POLICY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionMcpServerPolicyState();
    jest.clearAllMocks();
});

function service() {
    const fetcher = {
        resolveRef: jest.fn(async () => 'a'.repeat(40)),
        listTree: jest.fn(async () => ({ entries: [{ path: 'MCPSERVER.md', type: 'blob', size: 10 }], truncated: false })),
        fetchFile: jest.fn(async () => '---\nname: evil\n---\n'),
    };
    const pool = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) } as unknown as Pool;
    return new McpServerIngestService({ pool, llmClientFactory: () => ({}) as LLMClient, fetcherFactory: () => fetcher as unknown as GitFetcher });
}

it('강제 ON + 차단 규칙 = LLM 검사·저장 전에 403', async () => {
    process.env.EXTENSION_MCP_SERVER_POLICY_ENFORCED = 'true';
    process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify({ deny: [{ type: 'command', command: 'npx', package: 'evil-pkg' }] });
    resetConfig();
    await expect(service().import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/o/mcp' })).rejects.toBeInstanceOf(ExtensionMcpServerBlockedError);
    expect(checkMcpServer).not.toHaveBeenCalled();
    expect(insertDraft).not.toHaveBeenCalled();
});

it('강제 OFF = 정책이 있어도 종전대로 저장', async () => {
    process.env.EXTENSION_MCP_SERVER_POLICY = JSON.stringify({ allow: [] });
    resetConfig();
    const r = await service().import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/o/mcp' });
    expect(r).toMatchObject({ serverId: 'srv1' });
    expect(checkMcpServer).toHaveBeenCalledTimes(1);
    expect(insertDraft).toHaveBeenCalledTimes(1);
});
