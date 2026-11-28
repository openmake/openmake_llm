/**
 * OciFetcher — `oci://registry/repo:tag|@sha256:…` 확장 원본을 GitFetcher 동형(duck-typed)으로 제공한다(P8, opt-in).
 *
 * OCI Distribution API 를 **직접** 부른다(외부 바이너리·새 패키지 없음):
 *   GET /v2/<repo>/manifests/<ref>  →  레이어 blob GET  →  sha256 digest 검증  →  (gzip 해제)  →  tar 읽기
 * 인증: 익명 우선. 401 의 `WWW-Authenticate: Bearer realm=…,service=…` 면 토큰 교환(scope 는 서버 값이 아니라
 * 항상 `repository:<repo>:pull` — 넓은 권한을 요구하지 않는다). 사설 레지스트리는 사용자 accessToken
 * (`user:secret` 또는 토큰 단독)을 **레지스트리와 같은 호스트**의 토큰 엔드포인트·Basic 챌린지에만 보낸다.
 *
 * GitFetcher 동형:
 *   - resolveRef → 매니페스트 digest(`sha256:<hex>`) — 태그는 설치 시점 digest 로 고정돼 source_ref 에 기록되고,
 *     업데이트 확인은 같은 태그를 다시 풀어 digest 를 비교한다. 같은 인스턴스는 한 번만 받아 모든 호출이 같은 digest 를 본다.
 *   - listTree/fetchFile → 레이어를 차례로 겹친(whiteout 반영) 파일 맵
 *
 * 보안:
 *   - 모든 요청(레지스트리·토큰 realm·blob 리다이렉트)은 security/ssrf-guard safeFetch(내부망 차단·DNS rebinding·
 *     https→http 리다이렉트 거부·교차 origin 리다이렉트의 자격증명 헤더 제거)
 *   - https 만. 매니페스트·레이어 수·blob 합계·해제 총 크기·파일 수 상한, 본문은 상한까지만 읽는다
 *   - 레이어 미디어 타입 화이트리스트(tar · tar+gzip) · blob digest 검증 · 인덱스(멀티 플랫폼) 거절
 *   - 경로 탈출·크기·파일 수 방어는 ZIP 설치와 같은 함수(`collectArchiveFiles`)
 *
 * @module agents/git-ingest/oci-fetcher
 */
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { safeFetch } from '../../security/ssrf-guard';
import { createLogger } from '../../utils/logger';
import { EXTENSION_OCI_LIMITS, OCI_INDEX_MEDIA_TYPES, OCI_LAYER_MEDIA_TYPES, OCI_MANIFEST_MEDIA_TYPES } from '../../config/extension-oci';
import { collectArchiveFiles } from './archive-fetcher';
import { OCI_DIGEST_RE, parseOciReference, type OciReference } from './oci-reference';
import { readTar } from './tar-reader';
import type { TreeEntry, TreeResult } from './git-fetcher';

const logger = createLogger('OciFetcher');

export type OciFetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export interface OciFetcherLimits {
    manifestMaxBytes: number;
    maxLayers: number;
    maxBlobBytes: number;
    maxEntries: number;
    maxTotalBytes: number;
    tokenMaxBytes: number;
    requestTimeoutMs: number;
}

export interface OciFetcherOptions {
    accessToken?: string;
    /** 테스트 주입용 — 기본은 SSRF 가드 safeFetch */
    fetchImpl?: OciFetchImpl;
    limits?: Partial<OciFetcherLimits>;
}

function defaultLimits(): OciFetcherLimits {
    const L = EXTENSION_OCI_LIMITS;
    return {
        manifestMaxBytes: L.manifestMaxBytes, maxLayers: L.maxLayers, maxBlobBytes: L.maxBlobBytes,
        maxEntries: L.maxEntries, maxTotalBytes: L.maxTotalBytes, tokenMaxBytes: L.tokenMaxBytes,
        requestTimeoutMs: L.requestTimeoutMs,
    };
}

/** 본문을 상한까지만 읽는다(content-length 를 믿지 않는다) */
export async function readBodyCapped(res: Response, max: number, what: string): Promise<Uint8Array> {
    const declared = parseInt(res.headers.get('content-length') || '0', 10);
    if (declared > max) {
        await res.body?.cancel().catch(() => undefined);
        throw new Error(`OCI_TOO_LARGE: ${what} content-length ${declared} > ${max}`);
    }
    if (!res.body) return new Uint8Array(0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel().catch(() => undefined);
            throw new Error(`OCI_TOO_LARGE: ${what} > ${max}`);
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.byteLength; }
    return out;
}

/** PURE: `WWW-Authenticate` 파싱 — `Bearer realm="…",service="…"` / `Basic realm="…"` */
export function parseAuthChallenge(header: string | null): { scheme: 'bearer' | 'basic'; params: Record<string, string> } | null {
    if (!header) return null;
    const m = /^\s*(Bearer|Basic)\s*(.*)$/i.exec(header);
    if (!m) return null;
    const params: Record<string, string> = {};
    const re = /([A-Za-z_]+)\s*=\s*(?:"([^"]*)"|([^,\s]*))/g;
    for (let x = re.exec(m[2]); x; x = re.exec(m[2])) params[x[1].toLowerCase()] = x[2] ?? x[3] ?? '';
    return { scheme: m[1].toLowerCase() === 'bearer' ? 'bearer' : 'basic', params };
}

function basicCredential(accessToken: string): string {
    const pair = accessToken.includes(':') ? accessToken : `token:${accessToken}`;
    return `Basic ${Buffer.from(pair, 'utf-8').toString('base64')}`;
}

function sha256Digest(buf: Uint8Array): string {
    return `sha256:${crypto.createHash('sha256').update(buf).digest('hex')}`;
}

interface OciLayer { mediaType: string; digest: string; size: number }

/** PURE: 매니페스트 JSON 검증 → 레이어 목록 */
export function parseOciManifest(raw: Uint8Array, contentType: string | null, limits: Pick<OciFetcherLimits, 'maxLayers' | 'maxBlobBytes'>): OciLayer[] {
    let doc: unknown;
    try { doc = JSON.parse(Buffer.from(raw).toString('utf-8')); } catch { throw new Error('OCI_MANIFEST_INVALID: JSON 아님'); }
    const d = doc as { mediaType?: unknown; schemaVersion?: unknown; layers?: unknown; manifests?: unknown };
    const mediaType = typeof d.mediaType === 'string' ? d.mediaType : (contentType ?? '').split(';')[0].trim();
    if ((OCI_INDEX_MEDIA_TYPES as readonly string[]).includes(mediaType) || Array.isArray(d.manifests)) {
        throw new Error('OCI_INDEX_UNSUPPORTED: 멀티 플랫폼 인덱스는 설치할 수 없습니다 — 단일 매니페스트 digest 를 지정하세요');
    }
    if (d.schemaVersion !== 2 || !Array.isArray(d.layers)) throw new Error('OCI_MANIFEST_INVALID: schemaVersion 2 이미지 매니페스트가 아닙니다');
    if (mediaType && !(OCI_MANIFEST_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
        throw new Error(`OCI_MANIFEST_INVALID: 지원하지 않는 매니페스트 타입 ${mediaType}`);
    }
    if (d.layers.length === 0) throw new Error('OCI_EMPTY: 레이어 없음');
    if (d.layers.length > limits.maxLayers) throw new Error(`OCI_TOO_MANY_LAYERS: ${d.layers.length} > ${limits.maxLayers}`);
    let total = 0;
    return d.layers.map((l: unknown) => {
        const layer = l as { mediaType?: unknown; digest?: unknown; size?: unknown };
        if (typeof layer.mediaType !== 'string' || !Object.hasOwn(OCI_LAYER_MEDIA_TYPES, layer.mediaType)) {
            // `in` 은 상속 키(toString·constructor·__proto__)도 통과시킨다 — 화이트리스트는 자기 키만
            throw new Error(`OCI_LAYER_MEDIA_TYPE_REJECTED: ${String(layer.mediaType)} — tar · tar+gzip 레이어만 설치할 수 있습니다`);
        }
        if (typeof layer.digest !== 'string' || !OCI_DIGEST_RE.test(layer.digest)) throw new Error('OCI_MANIFEST_INVALID: 레이어 digest 형식 오류(sha256 만)');
        if (typeof layer.size !== 'number' || !Number.isSafeInteger(layer.size) || layer.size < 0) throw new Error('OCI_MANIFEST_INVALID: 레이어 size 오류');
        total += layer.size;
        if (total > limits.maxBlobBytes) throw new Error(`OCI_TOO_LARGE: 레이어 합계 ${total} > ${limits.maxBlobBytes}`);
        return { mediaType: layer.mediaType, digest: layer.digest, size: layer.size };
    });
}

/** PURE: 레이어 겹치기 — 뒤 레이어가 앞을 덮고, whiteout(`.wh.<name>`·`.wh..wh..opq`)은 지운다 */
export function applyLayerEntries(acc: Map<string, Uint8Array>, entries: Array<{ path: string; data: Uint8Array }>): void {
    for (const { path, data } of entries) {
        const slash = path.lastIndexOf('/');
        const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
        const base = path.slice(slash + 1);
        if (base === '.wh..wh..opq') {
            for (const k of [...acc.keys()]) if (k.startsWith(dir) && k !== path) acc.delete(k);
            continue;
        }
        if (base.startsWith('.wh.')) {
            const target = `${dir}${base.slice(4)}`;
            acc.delete(target);
            for (const k of [...acc.keys()]) if (k.startsWith(`${target}/`)) acc.delete(k);
            continue;
        }
        acc.set(path, data);
    }
}

export class OciFetcher {
    private loaded: Promise<{ digest: string; files: Map<string, Uint8Array> }> | null = null;
    private readonly ref: OciReference;
    private readonly fetchImpl: OciFetchImpl;
    private readonly limits: OciFetcherLimits;
    private token: string | null = null;
    private basic: string | null = null;

    constructor(private readonly url: string, private readonly opts: OciFetcherOptions = {}) {
        const ref = parseOciReference(url);
        if (!ref) throw new Error(`INVALID_OCI_REFERENCE: ${url}`);
        this.ref = ref;
        this.fetchImpl = opts.fetchImpl ?? ((u, i) => safeFetch(u, i));
        this.limits = { ...defaultLimits(), ...(opts.limits ?? {}) };
    }

    private apiUrl(path: string): string {
        return `https://${this.ref.apiHost}/v2/${this.ref.repository}/${path}`;
    }

    private async timed(url: string, init: RequestInit): Promise<Response> {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), this.limits.requestTimeoutMs);
        try {
            return await this.fetchImpl(url, { ...init, signal: controller.signal });
        } finally {
            clearTimeout(tid);
        }
    }

    private authHeader(): Record<string, string> {
        if (this.token) return { Authorization: `Bearer ${this.token}` };
        if (this.basic) return { Authorization: this.basic };
        return {};
    }

    /** 401 챌린지 → 토큰 교환(또는 Basic). 처리했으면 true(재요청) */
    private async handleChallenge(res: Response): Promise<boolean> {
        const ch = parseAuthChallenge(res.headers.get('www-authenticate'));
        await res.body?.cancel().catch(() => undefined);
        if (!ch) return false;
        if (ch.scheme === 'basic') {
            if (!this.opts.accessToken || this.basic) return false;
            this.basic = basicCredential(this.opts.accessToken);   // 레지스트리 자신에게만 보낸다
            return true;
        }
        if (this.token) return false;
        const realm = ch.params.realm;
        if (!realm) throw new Error('OCI_AUTH_FAILED: 토큰 realm 없음');
        let realmUrl: URL;
        try { realmUrl = new URL(realm); } catch { throw new Error('OCI_AUTH_FAILED: realm URL 형식 오류'); }
        if (realmUrl.protocol !== 'https:') throw new Error('OCI_AUTH_FAILED: realm 은 https 여야 합니다');
        if (ch.params.service) realmUrl.searchParams.set('service', ch.params.service);
        realmUrl.searchParams.set('scope', `repository:${this.ref.repository}:pull`);
        const headers: Record<string, string> = { Accept: 'application/json' };
        // 자격증명은 레지스트리와 같은 호스트의 realm 에만(다른 호스트가 지정한 곳으로 사용자 토큰을 넘기지 않는다)
        if (this.opts.accessToken && realmUrl.host === this.ref.apiHost) headers.Authorization = basicCredential(this.opts.accessToken);
        const tr = await this.timed(realmUrl.toString(), { headers, redirect: 'error' });
        if (!tr.ok) {
            await tr.body?.cancel().catch(() => undefined);
            throw new Error(`OCI_AUTH_FAILED: 토큰 교환 ${tr.status}`);
        }
        const body = await readBodyCapped(tr, this.limits.tokenMaxBytes, 'token');
        let parsed: { token?: unknown; access_token?: unknown };
        try { parsed = JSON.parse(Buffer.from(body).toString('utf-8')); } catch { throw new Error('OCI_AUTH_FAILED: 토큰 응답 형식 오류'); }
        const token = typeof parsed.token === 'string' ? parsed.token : (typeof parsed.access_token === 'string' ? parsed.access_token : '');
        if (!token) throw new Error('OCI_AUTH_FAILED: 토큰 없음');
        this.token = token;
        return true;
    }

    /** 인증 재시도 포함 GET */
    private async get(url: string, accept: string): Promise<Response> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const res = await this.timed(url, { headers: { Accept: accept, ...this.authHeader() } });
            if (res.status !== 401) return res;
            if (!(await this.handleChallenge(res))) throw new Error('OCI_AUTH_FAILED: 401 — 레지스트리 인증 실패');
        }
        throw new Error('OCI_AUTH_FAILED: 인증 재시도 초과');
    }

    private load(): Promise<{ digest: string; files: Map<string, Uint8Array> }> {
        if (!this.loaded) this.loaded = this.doLoad();
        return this.loaded;
    }

    private async doLoad(): Promise<{ digest: string; files: Map<string, Uint8Array> }> {
        const reference = this.ref.digest ?? this.ref.tag ?? 'latest';
        const mres = await this.get(this.apiUrl(`manifests/${reference}`), [...OCI_MANIFEST_MEDIA_TYPES, ...OCI_INDEX_MEDIA_TYPES].join(', '));
        if (mres.status === 404) { await mres.body?.cancel().catch(() => undefined); throw new Error(`OCI_NOT_FOUND: ${this.ref.url}`); }
        if (!mres.ok) { await mres.body?.cancel().catch(() => undefined); throw new Error(`OCI_FETCH_FAIL: manifest ${mres.status}`); }
        const mraw = await readBodyCapped(mres, this.limits.manifestMaxBytes, 'manifest');
        const digest = sha256Digest(mraw);
        // digest 로 지정했으면 받은 매니페스트가 정확히 그것이어야 한다(레지스트리가 다른 내용을 주는 것 차단)
        if (this.ref.digest && digest !== this.ref.digest) throw new Error(`OCI_DIGEST_MISMATCH: manifest ${digest} ≠ ${this.ref.digest}`);
        const layers = parseOciManifest(mraw, mres.headers.get('content-type'), this.limits);

        const merged = new Map<string, Uint8Array>();
        let budget = this.limits.maxTotalBytes;
        for (const layer of layers) {
            const bres = await this.get(this.apiUrl(`blobs/${layer.digest}`), '*/*');
            if (!bres.ok) { await bres.body?.cancel().catch(() => undefined); throw new Error(`OCI_FETCH_FAIL: blob ${bres.status}`); }
            const blob = await readBodyCapped(bres, Math.min(layer.size, this.limits.maxBlobBytes), 'layer');
            if (blob.byteLength !== layer.size) throw new Error(`OCI_DIGEST_MISMATCH: layer size ${blob.byteLength} ≠ ${layer.size}`);
            if (sha256Digest(blob) !== layer.digest) throw new Error(`OCI_DIGEST_MISMATCH: layer ${layer.digest}`);
            let tarBytes: Uint8Array;
            if (OCI_LAYER_MEDIA_TYPES[layer.mediaType] === 'gzip') {
                try {
                    // 해제 출력 자체에 상한(남은 예산 + tar 헤더·패딩 여유) — 압축 폭탄은 메모리에 다 풀기 전에 끊는다
                    tarBytes = zlib.gunzipSync(blob, { maxOutputLength: budget + (this.limits.maxEntries * 4 + 2) * 1024 });
                } catch (e) {
                    const msg = e instanceof Error ? e.message : String(e);
                    if (/maxOutputLength|buffer|too large/i.test(msg) || (e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') {
                        throw new Error(`OCI_TOO_LARGE: 해제 총 크기 > ${this.limits.maxTotalBytes} (압축 폭탄 의심)`);
                    }
                    throw new Error(`OCI_LAYER_INVALID: gzip 해제 실패 — ${msg}`);
                }
            } else {
                tarBytes = blob;
            }
            const entries = readTar(tarBytes, { maxEntries: this.limits.maxEntries });
            for (const e of entries) budget -= e.data.byteLength;
            if (budget < 0) throw new Error(`OCI_TOO_LARGE: 해제 총 크기 > ${this.limits.maxTotalBytes} (압축 폭탄 의심)`);
            applyLayerEntries(merged, entries);
        }
        // 경로 탈출·총 크기·파일 수·빈 아카이브 — ZIP 설치와 같은 방어 함수
        const files = collectArchiveFiles(merged.entries(), { maxEntries: this.limits.maxEntries, maxTotalBytes: this.limits.maxTotalBytes }, { code: 'OCI', emptyDetail: '레이어에 파일 없음' });
        logger.info(`oci loaded: ${this.ref.url} (${layers.length} layers, ${files.size} files, digest=${digest.slice(7, 19)})`);
        return { digest, files };
    }

    /** GitFetcher 동형 — ref 인자는 무시(원본 URL 의 태그/digest 가 기준). 매니페스트 digest 를 ref 로 반환 */
    async resolveRef(_owner: string, _repo: string, _ref?: string): Promise<string> {
        return (await this.load()).digest;
    }

    async listTree(_owner: string, _repo: string, _sha: string, maxEntries: number = 10_000): Promise<TreeResult> {
        const { digest, files } = await this.load();
        const entries: TreeEntry[] = [];
        for (const [path, data] of files) {
            entries.push({ path, sha: '', size: data.byteLength, type: 'blob' });
            if (entries.length > maxEntries) throw new Error(`OCI_TOO_MANY_ENTRIES: > ${maxEntries}`);
        }
        return { sha: digest, entries, truncated: false, rateLimitRemaining: -1 };
    }

    async fetchFile(_owner: string, _repo: string, _sha: string, path: string, maxBytes?: number): Promise<string> {
        const { files } = await this.load();
        const data = files.get(path);
        if (!data) throw new Error(`OCI_FILE_NOT_FOUND: ${path}`);
        if (maxBytes && data.byteLength > maxBytes) throw new Error(`OCI_FILE_TOO_LARGE: ${path} (${data.byteLength} > ${maxBytes})`);
        return Buffer.from(data).toString('utf-8');
    }
}
