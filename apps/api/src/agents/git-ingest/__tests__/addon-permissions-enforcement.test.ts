/**
 * Add-on 권한 집행 — 설치형 번들의 MCP 서버 (2026-09-20).
 *
 * 계약: `openmake-addon.json` 을 동봉한 번들은 deny-by-default 다. `network:internet` 이 없으면
 * stdio 서버는 `--network none` 샌드박스로 저장되고 원격(HTTP) 서버는 설치에서 빠진다.
 * 매니페스트를 동봉하지 않은 종전 확장은 **아무것도 바뀌지 않는다**(하위호환).
 */
const insertDraft = jest.fn();
jest.mock('../../../data/repositories/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({ insertDraft })),
}));
jest.mock('../convention-checker', () => ({
    ConventionChecker: jest.fn().mockImplementation(() => ({
        checkMcpServer: async () => ({ findings: [], tokensUsed: 0 }),
    })),
    isBlockedByConvention: () => false,
}));

import { collectMcpDrafts, type ComponentContext } from '../extension-components';
import type { LLMClient } from '../../../llm/client';

const stdio = { name: 'local', transportType: 'stdio' as const, command: 'npx', args: ['-y', 'some-mcp@1.0.0'] };
const remote = { name: 'cloud', transportType: 'streamable-http' as const, url: 'https://mcp.example.com/mcp' };

function ctx(addonPermissions?: readonly string[]): ComponentContext {
    return {
        // resolveUniqueServerName 이 이름 충돌을 조회한다 — 충돌 없음으로 답한다
        pool: { query: async () => ({ rows: [], rowCount: 0 }) } as never,
        fetcher: {} as never, owner: 'o', repo: 'r', sha: 's',
        tree: { entries: [] } as never, root: '',
        userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/o/r',
        manifestPath: 'plugin.json', extensionName: 'ext', warnings: [],
        ...(addonPermissions !== undefined ? { addonPermissions } : {}),
    };
}
const llm = (() => ({})) as unknown as (model: string) => LLMClient;

beforeEach(() => {
    insertDraft.mockReset();
    insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
});

describe('collectMcpDrafts — add-on 권한 집행', () => {
    it('매니페스트 미동봉(종전 확장)은 그대로 — 네트워크 제한도 제외도 없다', async () => {
        const c = ctx(undefined);
        const res = await collectMcpDrafts(c, [stdio, remote], llm);

        expect(res.filter(r => !r.error)).toHaveLength(2);
        expect(insertDraft).toHaveBeenCalledTimes(2);
        for (const call of insertDraft.mock.calls) expect(call[0].sandboxNetwork).toBeUndefined();
        expect(c.warnings.join(' ')).not.toContain('MCP_NETWORK_PERMISSION_MISSING');
    });

    it('권한 없이 동봉하면 stdio 는 network none 으로 저장되고 원격 서버는 제외된다', async () => {
        const c = ctx([]);
        const res = await collectMcpDrafts(c, [stdio, remote], llm);

        expect(insertDraft).toHaveBeenCalledTimes(1);
        expect(insertDraft.mock.calls[0][0]).toMatchObject({ transportType: 'stdio', sandboxNetwork: 'none' });
        expect(res.find(r => r.name === 'cloud')?.error).toContain('PERMISSION_DENIED');
        expect(c.warnings.join(' ')).toContain('MCP_NETWORK_PERMISSION_MISSING');
    });

    it('network:internet 을 선언하면 둘 다 설치되고 네트워크 제한이 없다', async () => {
        const c = ctx(['network:internet']);
        const res = await collectMcpDrafts(c, [stdio, remote], llm);

        expect(res.filter(r => !r.error)).toHaveLength(2);
        for (const call of insertDraft.mock.calls) expect(call[0].sandboxNetwork).toBeUndefined();
    });

    it('다른 권한만 선언한 경우에도 네트워크는 닫힌다(권한은 서로를 열지 않는다)', async () => {
        await collectMcpDrafts(ctx(['database:addon']), [stdio], llm);
        expect(insertDraft.mock.calls[0][0].sandboxNetwork).toBe('none');
    });
});
