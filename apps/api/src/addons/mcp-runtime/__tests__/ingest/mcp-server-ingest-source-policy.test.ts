/**
 * import_mcp_server_from_git(채팅 도구·REST) 도 확장 원본 정책(M2, Base)을 fetch 전에 지난다.
 */
import { resetConfig } from '../../../../config/env';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../../llm/client';
import type { GitFetcher } from '../../../../agents/git-ingest/git-fetcher';
import { McpServerIngestService } from '../../ingest/mcp-server-ingest-service';
import { ExtensionSourceBlockedError } from '../../../../errors/extension-source-blocked.error';
import { resetExtensionSourcePolicyState } from '../../../../services/extensions/source-policy';

jest.mock('../../../../services/org/effective-policy', () => ({
    resolveEffectivePolicyStrict: jest.fn(async () => ({ extensionSource: undefined })),
}));
jest.mock('../../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: jest.fn(async () => undefined) }) }));

const KEYS = ['EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_SOURCE_POLICY'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

function service() {
    const fetcherFactory = jest.fn(() => ({ resolveRef: jest.fn(async () => { throw new Error('REPO_NOT_FOUND'); }) }) as unknown as GitFetcher);
    return { fetcherFactory, svc: new McpServerIngestService({ pool: {} as Pool, llmClientFactory: () => ({}) as LLMClient, fetcherFactory }) };
}

it('차단 원본이면 fetcher 를 만들기 전에 403, 플래그 OFF 면 종전대로 조회', async () => {
    process.env.EXTENSION_SOURCE_POLICY = JSON.stringify({ deny: [{ type: 'github', repo: 'evil/*' }] }); resetConfig();
    process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
    const on = service();
    await expect(on.svc.import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/evil/mcp' })).rejects.toBeInstanceOf(ExtensionSourceBlockedError);
    expect(on.fetcherFactory).not.toHaveBeenCalled();

    process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'false'; resetConfig();
    const off = service();
    await expect(off.svc.import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/evil/mcp' })).rejects.toThrow('REPO_NOT_FOUND');
    expect(off.fetcherFactory).toHaveBeenCalled();
});
