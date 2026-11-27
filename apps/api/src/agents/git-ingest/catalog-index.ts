/**
 * 카탈로그 정적 색인(index.json) 동기화 — 마켓플레이스 남은 개발계획 v3.7 M6.
 *
 * 큐레이션 저장소 CI 가 만든 색인 하나를 받아(HTTP 요청 1회, SSRF 가드 경유) 카탈로그 스냅샷을 만든다.
 * GitHub API(resolveRef·listTree·fetchFile)는 부르지 않는다. 다음이면 {@link CatalogIndexFallbackError} 를 던지고
 * 호출측(services/extensions/catalog-sync)이 종전 방식으로 동기화한 뒤 경고를 남긴다:
 *   받기 실패·크기 초과 · JSON 아님 · 모르는 형식/버전 · 항목 형태 오류 · 해시 불일치 · 색인의 저장소 ≠ 카탈로그 원본.
 *
 * 검증(형식 v1 — config/extension-catalog-index, 사본은 큐레이션 저장소 schema/catalog-index.v1.schema.json):
 *   - 항목 `sha256` = 그 항목에서 `sha256` 을 뺀 값의 정규 JSON(키 정렬·undefined 제외) sha256.
 *   - 최상위 `pluginsSha256` = 항목 sha256 들을 순서대로 `\n` 으로 이은 문자열의 sha256.
 *   - 항목 `commit` = 고정 커밋(40자 소문자 hex), 최상위 `commit` = 색인을 만든 큐레이션 저장소 커밋.
 *   해시는 색인 본문의 무결성(전송 중 손상·부분 기록·손편집)을 잡는다 — 출처 증명은 아니다(원본 정책 M2 가 따로 막는다).
 *
 * 원본 정책(M2): 카탈로그 원본 판정은 호출측(ExtensionIngestService)이 색인을 받기 **전에** 한다.
 * 교차 저장소 항목은 같은 해석본(isEntrySourceAllowed)으로 판정해 막힌 원본이면 설치 가능 판정을 싣지 않는다
 * (종전 스냅샷과 같은 규칙 — 막힌 원본엔 아무것도 확인하지 않는다).
 *
 * @module agents/git-ingest/catalog-index
 */
import { createHash } from 'crypto';
import { z } from 'zod';
import { parseGitUrl } from '../../schemas/git-ingest.schema';
import {
    CATALOG_INDEX_FALLBACK_CODES as CODES,
    CATALOG_INDEX_FORMAT,
    CATALOG_INDEX_LIMITS,
    type CatalogIndexFallbackCode,
} from '../../config/extension-catalog-index';
import type { CatalogSnapshot } from './catalog-snapshot';

/** 색인을 쓸 수 없음 — 호출측은 종전 방식으로 폴백한다 */
export class CatalogIndexFallbackError extends Error {
    constructor(public readonly code: CatalogIndexFallbackCode, detail: string) {
        super(`${code}: ${detail}`);
        this.name = 'CatalogIndexFallbackError';
    }
}

const SHA1_HEX = /^[0-9a-f]{40}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const compatValue = z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(200)).max(50)]);

const entrySchema = z.object({
    name: z.string().min(1).max(128),
    description: z.string().max(2000).optional(),
    version: z.string().max(64).optional(),
    category: z.string().max(64).optional(),
    source: z.object({
        type: z.enum(['git-subdir', 'url', 'relative']),
        url: z.string().max(500).optional(),
        path: z.string().max(300).optional(),
    }).strict(),
    commit: z.string().regex(SHA1_HEX),
    installable: z.boolean().optional(),
    compat: z.record(z.string().max(64), compatValue).optional(),
    sha256: z.string().regex(SHA256_HEX),
}).strict();

const indexSchema = z.object({
    schema: z.literal(CATALOG_INDEX_FORMAT.SCHEMA_ID),
    schemaVersion: z.literal(CATALOG_INDEX_FORMAT.SUPPORTED_VERSION),
    generatedAt: z.string().max(64),
    repository: z.string().max(200),
    commit: z.string().regex(SHA1_HEX),
    marketplace: z.object({ name: z.string().min(1).max(200), description: z.string().max(2000).optional() }).strict(),
    plugins: z.array(entrySchema).max(CATALOG_INDEX_LIMITS.MAX_PLUGINS),
    pluginsSha256: z.string().regex(SHA256_HEX),
}).strict();

export type CatalogIndex = z.infer<typeof indexSchema>;
export type CatalogIndexEntry = z.infer<typeof entrySchema>;

/** PURE: 정규 JSON — 객체 키 정렬, undefined 값 제외. 큐레이션 저장소 생성기와 같은 규칙 */
export function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value !== null && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
        return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** PURE: 항목 해시 — `sha256` 필드를 뺀 정규 JSON 의 sha256 */
export function entryDigest(entry: Omit<CatalogIndexEntry, 'sha256'> & { sha256?: string }): string {
    const { sha256: _omit, ...rest } = entry;
    return sha256Hex(canonicalJson(rest));
}

/** PURE: 전체 해시 — 항목 해시를 순서대로 줄바꿈으로 이은 문자열의 sha256 */
export function pluginsDigest(entryHashes: string[]): string {
    return sha256Hex(entryHashes.join('\n'));
}

/** PURE: 색인 본문 → 검증된 색인. 쓸 수 없으면 CatalogIndexFallbackError */
export function parseCatalogIndex(text: string): CatalogIndex {
    let raw: unknown;
    try { raw = JSON.parse(text); } catch {
        throw new CatalogIndexFallbackError(CODES.PARSE_FAILED, 'JSON 이 아닙니다');
    }
    const head = raw as { schema?: unknown; schemaVersion?: unknown } | null;
    if (!head || typeof head !== 'object' || head.schema !== CATALOG_INDEX_FORMAT.SCHEMA_ID
        || head.schemaVersion !== CATALOG_INDEX_FORMAT.SUPPORTED_VERSION) {
        throw new CatalogIndexFallbackError(CODES.SCHEMA_UNSUPPORTED,
            `지원하지 않는 색인 형식 (${String(head?.schema)} v${String(head?.schemaVersion)}, 지원 ${CATALOG_INDEX_FORMAT.SCHEMA_ID} v${CATALOG_INDEX_FORMAT.SUPPORTED_VERSION})`);
    }
    const parsed = indexSchema.safeParse(raw);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new CatalogIndexFallbackError(CODES.SHAPE_INVALID, `${first?.path.join('.') || '(root)'}: ${first?.message ?? 'invalid'}`);
    }
    const index = parsed.data;
    const hashes: string[] = [];
    for (const entry of index.plugins) {
        if (entryDigest(entry) !== entry.sha256) {
            throw new CatalogIndexFallbackError(CODES.HASH_MISMATCH, `항목 해시 불일치 (${entry.name})`);
        }
        hashes.push(entry.sha256);
    }
    if (pluginsDigest(hashes) !== index.pluginsSha256) {
        throw new CatalogIndexFallbackError(CODES.HASH_MISMATCH, '전체 해시(pluginsSha256) 불일치');
    }
    return index;
}

/** 색인 요청 함수 — 기본은 SSRF 가드(security/ssrf-guard safeFetch). 테스트가 주입한다 */
export type CatalogIndexFetch = (url: string, init: RequestInit) => Promise<Response>;

async function defaultIndexFetch(url: string, init: RequestInit): Promise<Response> {
    const { safeFetch } = await import('../../security/ssrf-guard');
    return safeFetch(url, init);
}

/** 색인 받기 — 요청 1회. 실패·크기 초과는 FETCH_FAILED */
export async function fetchCatalogIndexText(indexUrl: string, fetchImpl: CatalogIndexFetch = defaultIndexFetch): Promise<string> {
    let res: Response;
    try {
        res = await fetchImpl(indexUrl, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(CATALOG_INDEX_LIMITS.FETCH_TIMEOUT_MS),
        });
    } catch (e) {
        throw new CatalogIndexFallbackError(CODES.FETCH_FAILED, e instanceof Error ? e.message : String(e));
    }
    if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        throw new CatalogIndexFallbackError(CODES.FETCH_FAILED, `HTTP ${res.status}`);
    }
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > CATALOG_INDEX_LIMITS.MAX_BYTES) {
        await res.body?.cancel().catch(() => undefined);
        throw new CatalogIndexFallbackError(CODES.FETCH_FAILED, `색인이 너무 큽니다 (${declared} bytes)`);
    }
    const text = await res.text();
    if (Buffer.byteLength(text, 'utf8') > CATALOG_INDEX_LIMITS.MAX_BYTES) {
        throw new CatalogIndexFallbackError(CODES.FETCH_FAILED, '색인이 너무 큽니다');
    }
    return text;
}

/** PURE: 검증된 색인 → 카탈로그 스냅샷. 색인의 저장소가 카탈로그 원본과 다르면 REPOSITORY_MISMATCH */
export function indexToSnapshot(
    index: CatalogIndex,
    catalogUrl: string,
    isEntrySourceAllowed?: (url: string) => boolean,
): CatalogSnapshot {
    const catalogRepo = parseGitUrl(catalogUrl);
    const indexRepo = parseGitUrl(index.repository);
    if (!catalogRepo || !indexRepo
        || catalogRepo.owner.toLowerCase() !== indexRepo.owner.toLowerCase()
        || catalogRepo.repo.toLowerCase() !== indexRepo.repo.toLowerCase()) {
        throw new CatalogIndexFallbackError(CODES.REPOSITORY_MISMATCH, `색인 저장소(${index.repository}) ≠ 카탈로그 원본`);
    }
    const plugins: CatalogSnapshot['plugins'] = index.plugins.map((e) => {
        const target = e.source.url ? parseGitUrl(e.source.url) : null;
        const crossRepo = !!target && (target.owner.toLowerCase() !== catalogRepo.owner.toLowerCase()
            || target.repo.toLowerCase() !== catalogRepo.repo.toLowerCase());
        const base: CatalogSnapshot['plugins'][number] = { name: e.name };
        if (e.description !== undefined) base.description = e.description;
        if (e.version !== undefined) base.version = e.version;
        if (e.category !== undefined) base.category = e.category;
        if (crossRepo && e.source.url) {
            // 실제 원본 — 원본 정책 catalog-only 판정용(종전 스냅샷과 같은 필드). 막힌 원본은 설치 가능 판정을 싣지 않는다
            base.source = e.source.url;
            if (isEntrySourceAllowed && !isEntrySourceAllowed(e.source.url)) return base;
        }
        if (e.installable !== undefined) base.installable = e.installable;
        return base;
    });
    return { name: index.marketplace.name, description: index.marketplace.description ?? null, plugins };
}

/** 색인 하나로 스냅샷 — 받기(1회) → 검증 → 변환 */
export async function fetchCatalogSnapshotFromIndex(
    indexUrl: string,
    catalogUrl: string,
    isEntrySourceAllowed?: (url: string) => boolean,
    fetchImpl?: CatalogIndexFetch,
): Promise<CatalogSnapshot> {
    const text = await fetchCatalogIndexText(indexUrl, fetchImpl);
    return indexToSnapshot(parseCatalogIndex(text), catalogUrl, isEntrySourceAllowed);
}
