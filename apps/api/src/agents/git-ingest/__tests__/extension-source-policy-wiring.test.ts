/**
 * 확장 원본 정책(M2) 배선 — 설치 엔진 진입부가 **네트워크 작업 전에** 정책을 검사하는지 고정한다.
 *
 * fetcher(GitHub API·아카이브 다운로드)를 jest.fn 으로 두고, 차단 원본에서 fetcherFactory·resolveRef 호출이 0 인지 본다.
 * 플래그 OFF 면 같은 정책이 있어도 fetcher 가 불린다(종전 동작).
 */
import { resetConfig } from '../../../config/env';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../llm/client';
import type { GitFetcher } from '../git-fetcher';
import { ExtensionIngestService } from '../extension-ingest-service';
import { GitIngestService } from '../git-ingest-service';
import { AgentIngestService } from '../agent-ingest-service';
import { ExtensionSourceBlockedError } from '../../../errors/extension-source-blocked.error';
import { resetExtensionSourcePolicyState } from '../../../services/extensions/source-policy';

jest.mock('../../../services/org/effective-policy', () => ({
    resolveEffectivePolicyStrict: jest.fn(async () => ({ extensionSource: undefined })),
}));
const mockLogAudit = jest.fn(async () => undefined);
jest.mock('../../../services/AuditService', () => ({ getAuditService: () => ({ logAudit: mockLogAudit }) }));
jest.mock('../../../data/repositories/extension-catalog-repository', () => ({
    ExtensionCatalogRepository: jest.fn().mockImplementation(() => ({ listEnabled: async () => [] })),
}));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

const KEYS = ['EXTENSION_SOURCE_POLICY_ENFORCED', 'EXTENSION_ARBITRARY_URL_INSTALL', 'EXTENSION_SOURCE_POLICY', 'EXTENSION_INGEST_ENABLED'] as const;
const ORIGINAL = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const DENY_EVIL = JSON.stringify({ deny: [{ type: 'github', repo: 'evil/*' }, { type: 'hostPattern', pattern: '(^|\\.)evil\\.example$' }] });

const SHA = 'a'.repeat(40);
const MARKETPLACE = JSON.stringify({
    name: 'good-market',
    plugins: [{ name: 'trojan', source: { source: 'git-subdir', url: 'https://github.com/evil/plugin', path: 'p' } }],
});

/** 마켓플레이스 저장소(good/market) 하나를 흉내 내는 fetcher — 호출 기록용 */
function fakeFetcher() {
    return {
        resolveRef: jest.fn(async () => SHA),
        listTree: jest.fn(async () => ({ sha: SHA, entries: [{ path: '.claude-plugin/marketplace.json', sha: 'm', size: 10, type: 'blob' as const }], truncated: false, rateLimitRemaining: 100 })),
        fetchFile: jest.fn(async (_o: string, _r: string, _s: string, path: string) => {
            if (path.endsWith('marketplace.json')) return MARKETPLACE;
            throw new Error('NOT_FOUND');
        }),
    };
}

function services() {
    const fetcher = fakeFetcher();
    const fetcherFactory = jest.fn(() => fetcher as unknown as GitFetcher);
    const archiveFetcherFactory = jest.fn(() => fetcher as unknown as GitFetcher);
    const opts = { pool: {} as Pool, llmClientFactory: () => ({}) as LLMClient, fetcherFactory, archiveFetcherFactory };
    return { fetcher, fetcherFactory, archiveFetcherFactory, ext: new ExtensionIngestService(opts), opts };
}

const resolvedOwners = (f: ReturnType<typeof fakeFetcher>) => f.resolveRef.mock.calls.map((c) => (c as unknown[])[0]);

beforeEach(() => {
    process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'true'; resetConfig();
    process.env.EXTENSION_SOURCE_POLICY = DENY_EVIL; resetConfig();
    process.env.EXTENSION_INGEST_ENABLED = 'true'; resetConfig();
    mockLogAudit.mockClear();
});
afterEach(() => {
    for (const k of KEYS) { if (ORIGINAL[k] === undefined) delete process.env[k]; else process.env[k] = ORIGINAL[k]; }
    resetConfig();
    resetExtensionSourcePolicyState();
});

describe('ExtensionIngestService — 채팅 도구·갤러리·카탈로그·내부 게시 공통 진입점', () => {
    it.each([
        'https://github.com/evil/pack',
        'ssh://git@github.com/Evil/Pack.git',
        'https://cdn.evil.example/pack.zip',
    ])('차단 원본 %s 은 fetcher 를 만들기 전에 403', async (url) => {
        const s = services();
        await expect(s.ext.import({ userId: 'u1', isAdmin: false, gitUrl: url })).rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        expect(s.fetcherFactory).not.toHaveBeenCalled();
        expect(s.archiveFetcherFactory).not.toHaveBeenCalled();
        expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'extension.source_blocked', userId: 'u1' }));
    });

    it('허용된 마켓의 항목이 차단 저장소를 가리키면 그 저장소를 조회하기 전에 403', async () => {
        const s = services();
        await expect(s.ext.import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/good/market', plugin: 'trojan' }))
            .rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        expect(resolvedOwners(s.fetcher)).toEqual(['good']);   // 마켓 저장소만 — evil 은 0회
    });

    it('업데이트 확인: 차단 원본이면 원격 조회 0회', async () => {
        const s = services();
        await expect(s.ext.checkForUpdate({ sourceUrl: 'https://github.com/evil/pack', sourcePath: 'plugin.json', currentRef: SHA, userId: 'u1' }))
            .rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        expect(s.fetcherFactory).not.toHaveBeenCalled();
    });

    it('카탈로그 등록: 차단 원본이면 0회, 허용 카탈로그의 차단 항목은 프로브하지 않고 source 만 남긴다', async () => {
        const blocked = services();
        await expect(blocked.ext.fetchCatalogSnapshot('https://github.com/evil/market', 'tok', { userId: 'admin', action: 'catalog-register' }))
            .rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        expect(blocked.fetcherFactory).not.toHaveBeenCalled();

        const ok = services();
        const snap = await ok.ext.fetchCatalogSnapshot('https://github.com/good/market', 'tok', { userId: 'admin', action: 'catalog-sync' });
        expect(resolvedOwners(ok.fetcher)).toEqual(['good']);
        expect(snap.plugins).toEqual([expect.objectContaining({ name: 'trojan', source: 'https://github.com/evil/plugin' })]);
        expect(snap.plugins[0].installable).toBeUndefined();
    });

    it('catalog-only: 등록되지 않은 URL 직접 설치는 fetcher 전에 403', async () => {
        process.env.EXTENSION_SOURCE_POLICY = ''; resetConfig();
        process.env.EXTENSION_ARBITRARY_URL_INSTALL = 'catalog-only'; resetConfig();
        const s = services();
        await expect(s.ext.import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/random/pack' }))
            .rejects.toMatchObject({ detail: { reason: 'CATALOG_ONLY' } });
        expect(s.fetcherFactory).not.toHaveBeenCalled();
    });

    it('플래그 OFF 면 같은 정책이 있어도 검사하지 않는다(종전 동작)', async () => {
        process.env.EXTENSION_SOURCE_POLICY_ENFORCED = 'false'; resetConfig();
        const s = services();
        await s.ext.import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/evil/pack' }).catch(() => undefined);
        expect(s.fetcherFactory).toHaveBeenCalled();
        expect(mockLogAudit).not.toHaveBeenCalled();
    });
});

describe('스킬·에이전트 채팅 도구 진입점', () => {
    it('GitIngestService: 차단 원본은 fetcher 전에 403, 생성자 옵션 sourcePolicyPrechecked 만 건너뛴다', async () => {
        const s = services();
        await expect(new GitIngestService(s.opts).import({ userId: 'u1', isAdmin: false, gitUrl: 'evil/skill', target: 'user' }))
            .rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        expect(s.fetcherFactory).not.toHaveBeenCalled();

        await new GitIngestService({ ...s.opts, sourcePolicyPrechecked: true }).import({ userId: 'u1', isAdmin: false, gitUrl: 'evil/skill', target: 'user' }).catch(() => undefined);
        expect(s.fetcherFactory).toHaveBeenCalled();
    });

    it('AgentIngestService: 차단 원본은 fetcher 전에 403', async () => {
        const s = services();
        await expect(new AgentIngestService(s.opts).import({ userId: 'u1', isAdmin: false, gitUrl: 'https://github.com/evil/agent' }))
            .rejects.toBeInstanceOf(ExtensionSourceBlockedError);
        expect(s.fetcherFactory).not.toHaveBeenCalled();
    });
});
