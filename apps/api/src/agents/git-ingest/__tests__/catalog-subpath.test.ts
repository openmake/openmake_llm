/**
 * 카탈로그 하위 경로(M4 — source_subpath): 스냅샷과 설치가 같은 디렉터리를 카탈로그 루트로 본다.
 * 하위 경로가 없으면 종전대로 저장소 루트의 marketplace.json 을 쓴다.
 */
import { ExtensionIngestService } from '../extension-ingest-service';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../llm/client';
import type { GitFetcher } from '../git-fetcher';
import { resetConfig } from '../../../config/env';

jest.mock('../../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

const ROOT_MK = JSON.stringify({ name: 'root-market', plugins: [{ name: 'root-plugin', source: './root-plugin' }] });
const SUB_MK = JSON.stringify({ name: 'sub-market', plugins: [{ name: 'sub-plugin', source: './sub-plugin' }] });

const tree = {
    sha: 'abc',
    truncated: false,
    rateLimitRemaining: 4999,
    entries: [
        '.claude-plugin/marketplace.json',
        'root-plugin/skills/a/SKILL.md',
        'catalogs/team/.claude-plugin/marketplace.json',
        'catalogs/team/sub-plugin/skills/b/SKILL.md',
    ].map((path) => ({ path, sha: 'b', size: 10, type: 'blob' as const })),
};

function makeService() {
    const fetcher = {
        resolveRef: jest.fn(async () => 'abc'),
        listTree: jest.fn(async () => tree),
        fetchFile: jest.fn(async (_o: string, _r: string, _s: string, path: string) => {
            if (path === '.claude-plugin/marketplace.json') return ROOT_MK;
            if (path === 'catalogs/team/.claude-plugin/marketplace.json') return SUB_MK;
            throw new Error(`UPSTREAM_FETCH_FAIL: 404 ${path}`);
        }),
    };
    const svc = new ExtensionIngestService({
        pool: { query: jest.fn() } as unknown as Pool,
        llmClientFactory: () => ({ chat: jest.fn() }) as unknown as LLMClient,
        fetcherFactory: () => fetcher as unknown as GitFetcher,
    });
    return { svc, fetcher };
}

const ORIGINAL = process.env.EXTENSION_INGEST_ENABLED;
beforeEach(() => { process.env.EXTENSION_INGEST_ENABLED = 'true'; resetConfig(); });
afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.EXTENSION_INGEST_ENABLED; else process.env.EXTENSION_INGEST_ENABLED = ORIGINAL;
    resetConfig();
});

describe('fetchCatalogSnapshot 하위 경로', () => {
    it('하위 경로 없음 = 저장소 루트 marketplace (종전)', async () => {
        const { svc } = makeService();
        const snap = await svc.fetchCatalogSnapshot('https://github.com/acme/repo');
        expect(snap.name).toBe('root-market');
        expect(snap.plugins).toEqual([expect.objectContaining({ name: 'root-plugin', installable: true })]);
    });

    it('하위 경로 = 그 디렉터리의 marketplace, 항목 경로도 그 루트 기준으로 판정', async () => {
        const { svc } = makeService();
        const snap = await svc.fetchCatalogSnapshot('https://github.com/acme/repo', undefined, { action: 'catalog-sync' }, 'catalogs/team');
        expect(snap.name).toBe('sub-market');
        expect(snap.plugins).toEqual([expect.objectContaining({ name: 'sub-plugin', installable: true })]);
    });
});

describe('import 의 catalogSubpath', () => {
    it('없으면 루트 marketplace 목록, 있으면 하위 경로 marketplace 목록', async () => {
        const a = makeService();
        const rootList = await a.svc.import({ userId: 'u', isAdmin: false, gitUrl: 'https://github.com/acme/repo' });
        expect('marketplace' in rootList && rootList.marketplace?.name).toBe('root-market');

        const b = makeService();
        const subList = await b.svc.import({ userId: 'u', isAdmin: false, gitUrl: 'https://github.com/acme/repo', catalogSubpath: 'catalogs/team' });
        expect('marketplace' in subList && subList.marketplace?.name).toBe('sub-market');
    });
});
