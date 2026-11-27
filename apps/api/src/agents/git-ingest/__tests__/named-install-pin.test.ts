/**
 * 이름 설치(M5)의 고정 커밋 — marketplace 항목 `sha`(40자 소문자 hex)가 ref 보다 우선한다.
 * URL 설치(pinEntrySha 없음)는 종전대로 ref 를 따른다(회귀 0). 잘못된 sha 는 무시한다.
 */
import { ExtensionIngestService } from '../extension-ingest-service';
import { parseMarketplaceFile } from '../extension-manifest-validator';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../llm/client';
import type { GitFetcher } from '../git-fetcher';
import { resetConfig } from '../../../config/env';

jest.mock('../../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

const SHA = 'a'.repeat(40);
const MK = (sha: string) => JSON.stringify({
    name: 'acme',
    plugins: [{ name: 'lint', source: { source: 'git-subdir', path: 'lint', ref: 'v1.2.0', sha } }],
});

function makeService(mk: string) {
    const fetcher = {
        resolveRef: jest.fn(async (_o: string, _r: string, ref: string) => (ref === 'HEAD' ? 'head' : `resolved:${ref}`)),
        listTree: jest.fn(async (_o: string, _r: string, s: string) => {
            if (s !== 'head') throw new Error('STOP_AFTER_RESOLVE');
            return { sha: 'head', truncated: false, rateLimitRemaining: 4999, entries: [{ path: '.claude-plugin/marketplace.json', sha: 'b', size: 1, type: 'blob' as const }] };
        }),
        fetchFile: jest.fn(async () => mk),
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

it('marketplace 파싱: 40자 소문자 hex sha 만 채택', () => {
    const ok = parseMarketplaceFile(MK(SHA));
    expect(ok.ok && ok.marketplace.plugins[0].sha).toBe(SHA);
    const bad = parseMarketplaceFile(MK('A'.repeat(40)));
    expect(bad.ok && bad.marketplace.plugins[0].sha).toBeUndefined();
});

it('이름 설치(pinEntrySha): sha 로 고정', async () => {
    const { svc, fetcher } = makeService(MK(SHA));
    await expect(svc.import({ userId: 'u', isAdmin: false, gitUrl: 'https://github.com/acme/m', plugin: 'lint', pinEntrySha: true })).rejects.toThrow('STOP_AFTER_RESOLVE');
    expect(fetcher.resolveRef).toHaveBeenLastCalledWith('acme', 'm', SHA);
});

it('URL 설치(종전): ref 를 따른다', async () => {
    const { svc, fetcher } = makeService(MK(SHA));
    await expect(svc.import({ userId: 'u', isAdmin: false, gitUrl: 'https://github.com/acme/m', plugin: 'lint' })).rejects.toThrow('STOP_AFTER_RESOLVE');
    expect(fetcher.resolveRef).toHaveBeenLastCalledWith('acme', 'm', 'v1.2.0');
});

it('이름 설치라도 sha 가 규칙 밖이면 ref', async () => {
    const { svc, fetcher } = makeService(MK('deadbeef'));
    await expect(svc.import({ userId: 'u', isAdmin: false, gitUrl: 'https://github.com/acme/m', plugin: 'lint', pinEntrySha: true })).rejects.toThrow('STOP_AFTER_RESOLVE');
    expect(fetcher.resolveRef).toHaveBeenLastCalledWith('acme', 'm', 'v1.2.0');
});
