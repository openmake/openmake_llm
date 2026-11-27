/**
 * 카탈로그 정적 색인(M6) — 형식·버전·해시 검증, 저장소 일치, 원본 정책 적용, 요청 1회.
 * fixture 는 큐레이션 저장소(openmake/openmake-marketplace) 생성기 scripts/build-index.mjs 가 만든 실제 index.json 사본이다.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    CatalogIndexFallbackError,
    canonicalJson,
    entryDigest,
    fetchCatalogSnapshotFromIndex,
    indexToSnapshot,
    parseCatalogIndex,
    pluginsDigest,
} from '../catalog-index';
import { CATALOG_INDEX_FALLBACK_CODES as CODES, normalizeCatalogIndexUrl } from '../../../config/extension-catalog-index';

const FIXTURE_DIR = join(__dirname, 'fixtures', 'catalog-index');
const FIXTURE_TEXT = readFileSync(join(FIXTURE_DIR, 'openmake-marketplace.index.json'), 'utf8');
const CATALOG_URL = 'https://github.com/openmake/openmake-marketplace';
const INDEX_URL = 'https://github.com/openmake/openmake-marketplace/releases/download/catalog-index/index.json';

function fixture(): Record<string, any> {
    return JSON.parse(FIXTURE_TEXT);
}

/** 내용을 바꾼 뒤 해시를 다시 맞춘 색인 */
function rehash(idx: Record<string, any>): Record<string, any> {
    for (const p of idx.plugins) p.sha256 = entryDigest(p);
    idx.pluginsSha256 = pluginsDigest(idx.plugins.map((p: { sha256: string }) => p.sha256));
    return idx;
}

function expectFallback(fn: () => unknown, code: string) {
    try { fn(); } catch (e) {
        expect(e).toBeInstanceOf(CatalogIndexFallbackError);
        expect((e as CatalogIndexFallbackError).code).toBe(code);
        return;
    }
    throw new Error('expected CatalogIndexFallbackError');
}

function okResponse(text: string): Response {
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('parseCatalogIndex — 큐레이션 저장소 생성기 fixture', () => {
    it('실제 생성 색인을 검증하고 받아들인다 (13개 · 고정 커밋)', () => {
        const idx = parseCatalogIndex(FIXTURE_TEXT);
        expect(idx.schema).toBe('openmake.catalog-index');
        expect(idx.schemaVersion).toBe(1);
        expect(idx.plugins).toHaveLength(13);
        for (const p of idx.plugins) expect(p.commit).toMatch(/^[0-9a-f]{40}$/);
    });

    it('정규 JSON 은 키 정렬·undefined 제외 (생성기와 같은 규칙)', () => {
        expect(canonicalJson({ b: 1, a: [{ d: undefined, c: 'x' }] })).toBe('{"a":[{"c":"x"}],"b":1}');
    });

    it('모르는 버전은 SCHEMA_UNSUPPORTED (폴백)', () => {
        const idx = fixture(); idx.schemaVersion = 2;
        expectFallback(() => parseCatalogIndex(JSON.stringify(idx)), CODES.SCHEMA_UNSUPPORTED);
        const other = fixture(); other.schema = 'someone.else';
        expectFallback(() => parseCatalogIndex(JSON.stringify(other)), CODES.SCHEMA_UNSUPPORTED);
    });

    it('JSON 아님 → PARSE_FAILED · 형태 오류 → SHAPE_INVALID', () => {
        expectFallback(() => parseCatalogIndex('<html>'), CODES.PARSE_FAILED);
        const idx = fixture(); idx.plugins[0].commit = 'main';
        expectFallback(() => parseCatalogIndex(JSON.stringify(rehash(idx))), CODES.SHAPE_INVALID);
    });

    it('항목 내용이 바뀌었는데 해시가 그대로면 HASH_MISMATCH', () => {
        const idx = fixture(); idx.plugins[2].description = 'tampered';
        expectFallback(() => parseCatalogIndex(JSON.stringify(idx)), CODES.HASH_MISMATCH);
    });

    it('항목 고정 커밋이 바뀌어도 HASH_MISMATCH', () => {
        const idx = fixture(); idx.plugins[0].commit = 'f'.repeat(40);
        expectFallback(() => parseCatalogIndex(JSON.stringify(idx)), CODES.HASH_MISMATCH);
    });

    it('항목을 빼거나 순서를 바꾸면 전체 해시 불일치', () => {
        const idx = fixture(); idx.plugins.pop();
        expectFallback(() => parseCatalogIndex(JSON.stringify(idx)), CODES.HASH_MISMATCH);
        const swapped = fixture(); swapped.plugins.reverse();
        expectFallback(() => parseCatalogIndex(JSON.stringify(swapped)), CODES.HASH_MISMATCH);
    });
});

describe('indexToSnapshot', () => {
    it('카탈로그 스냅샷 형태로 바꾼다 — 교차 저장소 항목은 실제 원본(source)을 싣는다', () => {
        const snap = indexToSnapshot(parseCatalogIndex(FIXTURE_TEXT), CATALOG_URL);
        expect(snap.name).toBe(fixture().marketplace.name);
        expect(snap.plugins).toHaveLength(13);
        const local = snap.plugins.find((p) => p.name === 'openmake-log-analysis');
        expect(local).toMatchObject({ installable: true });
        expect(local?.source).toBeUndefined();
        const external = snap.plugins.filter((p) => p.source);
        expect(external.length).toBe(12);
        for (const p of external) expect(p.installable).toBe(true);
    });

    it('색인의 저장소가 카탈로그 원본과 다르면 REPOSITORY_MISMATCH', () => {
        const idx = parseCatalogIndex(FIXTURE_TEXT);
        expectFallback(() => indexToSnapshot(idx, 'https://github.com/evil/market'), CODES.REPOSITORY_MISMATCH);
    });

    it('원본 정책(M2)이 막은 실제 원본 항목은 설치 가능 판정을 싣지 않는다', () => {
        const idx = parseCatalogIndex(FIXTURE_TEXT);
        const blockedUrl = idx.plugins.find((p) => p.source.url)!.source.url!;
        const snap = indexToSnapshot(idx, CATALOG_URL, (u) => u !== blockedUrl);
        const blocked = snap.plugins.filter((p) => p.source === blockedUrl);
        expect(blocked.length).toBeGreaterThan(0);
        for (const p of blocked) expect(p.installable).toBeUndefined();
        const allowed = snap.plugins.filter((p) => p.source && p.source !== blockedUrl);
        for (const p of allowed) expect(p.installable).toBe(true);
    });
});

describe('fetchCatalogSnapshotFromIndex — 요청 1회', () => {
    it('색인 하나만 받는다 (요청 1회, GET · JSON)', async () => {
        const fetchImpl = jest.fn(async (_url: string, _init: RequestInit) => okResponse(FIXTURE_TEXT));
        const snap = await fetchCatalogSnapshotFromIndex(INDEX_URL, CATALOG_URL, undefined, fetchImpl);
        expect(snap.plugins).toHaveLength(13);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe(INDEX_URL);
    });

    it('HTTP 오류·요청 실패는 FETCH_FAILED', async () => {
        await expect(fetchCatalogSnapshotFromIndex(INDEX_URL, CATALOG_URL, undefined, async () => new Response('nope', { status: 404 })))
            .rejects.toMatchObject({ code: CODES.FETCH_FAILED });
        await expect(fetchCatalogSnapshotFromIndex(INDEX_URL, CATALOG_URL, undefined, async () => { throw new Error('SSRF blocked'); }))
            .rejects.toMatchObject({ code: CODES.FETCH_FAILED });
    });

    it('선언 크기가 상한을 넘으면 본문을 읽지 않고 FETCH_FAILED', async () => {
        const res = new Response('{}', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } });
        await expect(fetchCatalogSnapshotFromIndex(INDEX_URL, CATALOG_URL, undefined, async () => res))
            .rejects.toMatchObject({ code: CODES.FETCH_FAILED });
    });
});

describe('normalizeCatalogIndexUrl', () => {
    it('빈 값은 null(미사용), https 만 받는다', () => {
        expect(normalizeCatalogIndexUrl(null)).toBeNull();
        expect(normalizeCatalogIndexUrl('  ')).toBeNull();
        expect(normalizeCatalogIndexUrl(INDEX_URL)).toBe(INDEX_URL);
        expect(() => normalizeCatalogIndexUrl('http://example.com/index.json')).toThrow('INVALID_CATALOG_INDEX_URL');
        expect(() => normalizeCatalogIndexUrl('https://u:p@example.com/index.json')).toThrow('INVALID_CATALOG_INDEX_URL');
        expect(() => normalizeCatalogIndexUrl('https://example.com/i.json#x')).toThrow('INVALID_CATALOG_INDEX_URL');
        expect(() => normalizeCatalogIndexUrl('not a url')).toThrow('INVALID_CATALOG_INDEX_URL');
    });
});
