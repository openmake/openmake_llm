/**
 * 판정 서비스(M1) — 캐시 신선도(버전·만료·카탈로그 재동기화), 꺼진·없는 원본, 저장 실패 fail-open,
 * 그리고 **LLM 호출·외부 전송 0** (fetch·http(s)·LLM 클라이언트가 한 번도 불리지 않는다).
 */
import http from 'http';
import https from 'https';

const llmChat = jest.fn();
jest.mock('../../../llm/client', () => ({ LLMClient: jest.fn().mockImplementation(() => ({ chat: llmChat })) }));

import { getCatalogVerdicts, type VerdictServiceDeps } from '../service';
import { VERDICT_TTL_MS, VERDICT_VERSION } from '../constants';
import type { CatalogSourceView, InstalledExtensionEvidence } from '../../../runtime-ports/extension-catalog';
import type { CachedVerdict } from '../verdict-repository';

const NOW = Date.parse('2026-11-27T12:00:00Z');
const SYNCED = '2026-11-27T10:00:00.000Z';
const source: CatalogSourceView = {
    id: 'ext-cat-1', url: 'https://github.com/acme/market', name: 'Acme', enabled: true, lastSyncedAt: SYNCED,
    plugins: [{ name: 'alpha', installable: true }, { name: 'beta', installable: false }],
};

function cached(plugin: string, over: Partial<CachedVerdict> = {}): CachedVerdict {
    return {
        plugin, verdict: 'supported', reasons: [], evaluated: 'snapshot',
        provenance: { publisher: 'acme', commit: null, license: null, sourceUrl: source.url },
        verdictVersion: VERDICT_VERSION, catalogSyncedAt: SYNCED,
        computedAt: '2026-11-27T11:00:00.000Z', expiresAt: new Date(NOW + 60_000).toISOString(), ...over,
    };
}

function deps(over: { source?: CatalogSourceView | null; cache?: CachedVerdict[]; evidence?: InstalledExtensionEvidence[]; upsertFails?: boolean } = {}) {
    const repo = {
        listByCatalog: jest.fn(async () => over.cache ?? []),
        upsertMany: jest.fn(async () => { if (over.upsertFails) throw new Error('db down'); }),
        deleteMissing: jest.fn(async () => undefined),
    };
    const catalog = {
        getSource: jest.fn(async () => (over.source === undefined ? source : over.source)),
        listInstalledEvidence: jest.fn(async () => over.evidence ?? []),
    };
    const insights = jest.fn(async () => new Map());
    const d = { catalog, repo: () => repo, insights, now: () => NOW } as unknown as VerdictServiceDeps;
    return { d, repo, catalog, insights };
}

let fetchSpy: jest.SpyInstance;
let httpSpy: jest.SpyInstance;
let httpsSpy: jest.SpyInstance;
beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden in verdicts'));
    httpSpy = jest.spyOn(http, 'request');
    httpsSpy = jest.spyOn(https, 'request');
});
afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(llmChat).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

describe('getCatalogVerdicts', () => {
    it('캐시가 비면 전부 계산해 저장하고, 스냅샷에서 빠진 항목은 지운다', async () => {
        const { d, repo, catalog } = deps();
        const r = await getCatalogVerdicts('ext-cat-1', d);
        expect(r.verdictVersion).toBe(VERDICT_VERSION);
        expect(r.verdicts.map(v => [v.plugin, v.verdict])).toEqual([['alpha', 'supported'], ['beta', 'unsupported']]);
        expect(catalog.listInstalledEvidence).toHaveBeenCalledWith([source.url]);
        expect(repo.upsertMany).toHaveBeenCalledWith('ext-cat-1', expect.any(Array), {
            verdictVersion: VERDICT_VERSION, catalogSyncedAt: SYNCED, expiresAt: new Date(NOW + VERDICT_TTL_MS),
        });
        expect(repo.deleteMissing).toHaveBeenCalledWith('ext-cat-1', ['alpha', 'beta']);
    });

    it('신선한 캐시는 다시 계산하지 않는다', async () => {
        const { d, repo, catalog } = deps({ cache: [cached('alpha'), cached('beta', { verdict: 'unsupported' })] });
        const r = await getCatalogVerdicts('ext-cat-1', d);
        expect(r.verdicts.map(v => v.computedAt)).toEqual(['2026-11-27T11:00:00.000Z', '2026-11-27T11:00:00.000Z']);
        expect(catalog.listInstalledEvidence).not.toHaveBeenCalled();
        expect(repo.upsertMany).not.toHaveBeenCalled();
    });

    it.each([
        ['판정 버전이 다름', { verdictVersion: VERDICT_VERSION - 1 }],
        ['만료됨', { expiresAt: new Date(NOW - 1).toISOString() }],
        ['카탈로그가 다시 동기화됨', { catalogSyncedAt: '2026-11-26T00:00:00.000Z' }],
    ])('%s → 그 항목만 다시 계산', async (_label, over) => {
        const { d, repo } = deps({ cache: [cached('alpha', over), cached('beta', { verdict: 'unsupported' })] });
        await getCatalogVerdicts('ext-cat-1', d);
        const saved = (repo.upsertMany.mock.calls[0] as unknown as [string, Array<{ plugin: string }>])[1];
        expect(saved.map(v => v.plugin)).toEqual(['alpha']);
    });

    it('없는 원본·꺼진 원본은 404', async () => {
        await expect(getCatalogVerdicts('x', deps({ source: null }).d)).rejects.toMatchObject({ statusCode: 404, code: 'CATALOG_NOT_FOUND' });
        await expect(getCatalogVerdicts('x', deps({ source: { ...source, enabled: false } }).d)).rejects.toMatchObject({ statusCode: 404 });
    });

    it('캐시 저장 실패는 계산 결과를 그대로 돌려준다(fail-open)', async () => {
        const r = await getCatalogVerdicts('ext-cat-1', deps({ upsertFails: true }).d);
        expect(r.verdicts).toHaveLength(2);
    });

    it('설치본 근거가 있으면 그 항목은 installed 로 판정', async () => {
        const ev: InstalledExtensionEvidence = {
            name: 'alpha', version: '1', sourceUrl: source.url, sourcePath: '', commit: 'deadbeef', installedAt: '', author: null,
            license: 'Apache-2.0', homepage: null, warningCodes: [], agentCount: 0, mcpServers: [],
            skills: [{ name: 's', fromCommand: false, assetCount: 0, markers: [], unsupportedTools: [], requiredMissing: [], unsupportedFeatures: [], blocked: false, content: 'use mcp__x__y' }],
        };
        const r = await getCatalogVerdicts('ext-cat-1', deps({ evidence: [ev] }).d);
        expect(r.verdicts[0]).toMatchObject({ plugin: 'alpha', verdict: 'partial', evaluated: 'installed', provenance: { commit: 'deadbeef', license: 'Apache-2.0' } });
    });
});
