/**
 * 카탈로그 스냅샷 hasMcp (2026-11-28 ruflo 사례 — 플러그인 49개 중 MCP 정의 3개).
 * 이미 받은 트리로만 판정하고(추가 요청 없음), 플러그인 루트의 `.mcp.json`/`mcp.json` 만 본다.
 */
import { ExtensionIngestService } from '../extension-ingest-service';
import { hasMcpConfigAt } from '../catalog-snapshot';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../llm/client';
import type { GitFetcher } from '../git-fetcher';
import { resetConfig } from '../../../config/env';

jest.mock('../../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

const MK = JSON.stringify({
    name: 'ruflo',
    plugins: [
        { name: 'ruflo-core', source: './plugins/ruflo-core' },
        { name: 'ruflo-ai-team', source: './plugins/ruflo-ai-team/directory' },
        { name: 'ruflo-swarm', source: './plugins/ruflo-swarm' },
    ],
});
const entries = [
    '.claude-plugin/marketplace.json',
    'plugins/ruflo-core/.mcp.json',
    'plugins/ruflo-core/skills/a/SKILL.md',
    'plugins/ruflo-ai-team/directory/.mcp.json',
    'plugins/ruflo-swarm/skills/b/SKILL.md',
    'plugins/ruflo-swarm/docs/.mcp.json', // 루트가 아닌 곳의 파일은 세지 않는다
].map((path) => ({ path, sha: 'b', size: 10, type: 'blob' as const }));

function makeService(listTreeFails = false) {
    const fetcher = {
        resolveRef: jest.fn(async () => 'abc'),
        listTree: jest.fn(async () => {
            if (listTreeFails) throw new Error('TREE_TOO_LARGE');
            return { sha: 'abc', truncated: false, rateLimitRemaining: 4999, entries };
        }),
        fetchFile: jest.fn(async (_o: string, _r: string, _s: string, path: string) => {
            if (path === '.claude-plugin/marketplace.json') return MK;
            throw new Error(`UPSTREAM_FETCH_FAIL: 404 ${path}`);
        }),
    };
    return new ExtensionIngestService({
        pool: { query: jest.fn() } as unknown as Pool,
        llmClientFactory: () => ({ chat: jest.fn() }) as unknown as LLMClient,
        fetcherFactory: () => fetcher as unknown as GitFetcher,
    });
}

const ORIGINAL = process.env.EXTENSION_INGEST_ENABLED;
beforeEach(() => { process.env.EXTENSION_INGEST_ENABLED = 'true'; resetConfig(); });
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_INGEST_ENABLED; else process.env.EXTENSION_INGEST_ENABLED = ORIGINAL;
    resetConfig();
});

describe('hasMcpConfigAt (PURE)', () => {
    it('루트의 .mcp.json·mcp.json 만', () => {
        expect(hasMcpConfigAt(entries, 'plugins/ruflo-core/')).toBe(true);
        expect(hasMcpConfigAt(entries, 'plugins/ruflo-swarm/')).toBe(false);
        expect(hasMcpConfigAt([{ path: 'mcp.json', sha: 'b', size: 1, type: 'blob' }], '')).toBe(true);
    });
});

describe('fetchCatalogSnapshot hasMcp', () => {
    it('플러그인마다 MCP 정의 여부를 기록한다(하위 디렉터리 source 포함)', async () => {
        const snap = await makeService().fetchCatalogSnapshot('https://github.com/ruvnet/ruflo');
        const byName = Object.fromEntries(snap.plugins.map((p) => [p.name, p.hasMcp]));
        expect(byName).toEqual({ 'ruflo-core': true, 'ruflo-ai-team': true, 'ruflo-swarm': false });
    });

    it('트리를 못 받으면 필드 없음(미상)', async () => {
        const snap = await makeService(true).fetchCatalogSnapshot('https://github.com/ruvnet/ruflo');
        for (const p of snap.plugins) expect(p).not.toHaveProperty('hasMcp');
    });
});
