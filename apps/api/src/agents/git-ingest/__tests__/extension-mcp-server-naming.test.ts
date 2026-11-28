/**
 * 확장 MCP 서버 이름 (opt-in EXTENSION_MCP_SERVER_KEY_NAMES, 2026-11-28 ruflo 사례).
 *
 *  - OFF(기본): 종전 그대로 `<확장>-<서버 키>` (충돌 시 난수 접미사)
 *  - ON: 서버 키 그대로 → 차 있으면 종전 이름 → 그것도 차 있으면 종전 이름 + 난수 접미사
 */
const insertDraft = jest.fn();
jest.mock('../../../addons/mcp-runtime/data/mcp-server-draft-repository', () => ({
    McpServerDraftRepository: jest.fn().mockImplementation(() => ({ insertDraft })),
}));
jest.mock('../convention-checker', () => ({
    ConventionChecker: jest.fn().mockImplementation(() => ({
        checkMcpServer: async () => ({ findings: [], tokensUsed: 0 }),
    })),
    isBlockedByConvention: () => false,
}));

import { collectMcpDrafts, type ComponentContext } from '../extension-components';
import { mcpServerNameCandidates } from '../../../config/extension-naming';
import type { LLMClient } from '../../../llm/client';
import { resetConfig } from '../../../config/env';

const ruflo = { name: 'ruflo', transportType: 'stdio' as const, command: 'node', args: ['scripts/mcp-launch.cjs'] };

/** 사용자에게 이미 있는 서버 이름 — 이름 조회 SQL 의 파라미터에 이름이 들어 있으면 행을 돌려준다 */
function ctx(existing: string[]): ComponentContext {
    return {
        pool: {
            query: async (_sql: string, params?: unknown[]) => {
                const hit = (params ?? []).some((p) => typeof p === 'string' && existing.includes(p));
                return hit ? { rows: [{ id: 'taken' }], rowCount: 1 } : { rows: [], rowCount: 0 };
            },
        } as never,
        fetcher: {} as never, owner: 'ruvnet', repo: 'ruflo', sha: 's',
        tree: { entries: [] } as never, root: '',
        userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/ruvnet/ruflo',
        manifestPath: 'plugins/ruflo-core/.claude-plugin/plugin.json', extensionName: 'ruflo-core', warnings: [],
        addonPermissions: ['network:internet'],
    };
}
const llm = (() => ({})) as unknown as (model: string) => LLMClient;
const ORIGINAL = process.env.EXTENSION_MCP_SERVER_KEY_NAMES;
function setFlag(on: boolean | undefined): void {
    if (on === undefined) delete process.env.EXTENSION_MCP_SERVER_KEY_NAMES;
    else process.env.EXTENSION_MCP_SERVER_KEY_NAMES = on ? 'true' : 'false';
    resetConfig();
}
const savedName = (): string => insertDraft.mock.calls[0][0].name;

beforeEach(() => {
    insertDraft.mockReset();
    insertDraft.mockImplementation(async (input: { name: string }) => ({ id: `id-${input.name}` }));
});
afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_MCP_SERVER_KEY_NAMES;
    else process.env.EXTENSION_MCP_SERVER_KEY_NAMES = ORIGINAL;
    resetConfig();
});

describe('mcpServerNameCandidates (PURE)', () => {
    it('OFF 는 종전 이름 하나', () => {
        expect(mcpServerNameCandidates('ruflo-core', 'ruflo', false)).toEqual(['ruflo-core-ruflo']);
    });
    it('ON 은 서버 키 → 종전 이름', () => {
        expect(mcpServerNameCandidates('ruflo-core', 'ruflo', true)).toEqual(['ruflo', 'ruflo-core-ruflo']);
        expect(mcpServerNameCandidates('ruflo-ai-team', 'ruflo-ai-team', true)).toEqual(['ruflo-ai-team', 'ruflo-ai-team-ruflo-ai-team']);
    });
});

describe('collectMcpDrafts — 서버 이름', () => {
    it('플래그 OFF(기본) — 종전 그대로 <확장>-<키>', async () => {
        setFlag(undefined);
        await collectMcpDrafts(ctx([]), [ruflo], llm);
        expect(savedName()).toBe('ruflo-core-ruflo');
    });

    it('플래그 OFF — 종전 이름이 차 있으면 종전처럼 난수 접미사', async () => {
        setFlag(false);
        await collectMcpDrafts(ctx(['ruflo-core-ruflo']), [ruflo], llm);
        expect(savedName()).toMatch(/^ruflo-core-ruflo-[0-9a-f]{6}$/);
    });

    it('플래그 ON — 서버 키 그대로(스킬 본문의 mcp__ruflo__* 와 같은 이름)', async () => {
        setFlag(true);
        await collectMcpDrafts(ctx([]), [ruflo], llm);
        expect(savedName()).toBe('ruflo');
    });

    it('플래그 ON — 서버 키가 차 있으면 종전 이름, 둘 다 차 있으면 종전 이름 + 난수', async () => {
        setFlag(true);
        await collectMcpDrafts(ctx(['ruflo']), [ruflo], llm);
        expect(savedName()).toBe('ruflo-core-ruflo');

        insertDraft.mockClear();
        await collectMcpDrafts(ctx(['ruflo', 'ruflo-core-ruflo']), [ruflo], llm);
        expect(savedName()).toMatch(/^ruflo-core-ruflo-[0-9a-f]{6}$/);
    });
});
