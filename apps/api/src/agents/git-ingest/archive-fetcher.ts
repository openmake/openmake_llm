/**
 * ArchiveFetcher — .zip 아카이브 URL 을 GitFetcher 와 동형(duck-typed) 인터페이스로 제공.
 *
 * 확장 ingest 파이프라인(ExtensionIngestService·체인 GitIngestService)이 git 저장소 대신
 * 아카이브 URL 로도 동작하게 한다:
 *   - resolveRef  → 아카이브 바이트의 sha256 (source_ref 로 영속 — 업데이트 확인은 재다운로드 해시 비교)
 *   - listTree    → zip 엔트리 목록 (공통 최상위 디렉토리 1겹 자동 제거 — GitHub 소스 zip 래핑 대응)
 *   - fetchFile   → zip 엔트리 텍스트
 *
 * 보안:
 *   - 다운로드는 security/ssrf-guard 의 safeFetch (내부망 차단 + DNS rebinding 방어 + 리다이렉트 검증)
 *   - 압축 크기/엔트리 수/파일당 크기/총 해제 크기 상한 (압축 폭탄 방어)
 *   - zip-slip 차단: '..'/절대경로 엔트리 제외
 *
 * @module agents/git-ingest/archive-fetcher
 */
import * as crypto from 'crypto';
import { unzipSync } from 'fflate';
import { safeFetch } from '../../security/ssrf-guard';
import { createLogger } from '../../utils/logger';
import type { TreeEntry, TreeResult } from './git-fetcher';

const logger = createLogger('ArchiveFetcher');

/** .zip URL 판별 (query string 허용). */
export function isArchiveUrl(url: string): boolean {
    return /^https?:\/\/[^\s]+\.zip(\?[^\s]*)?$/i.test(url.trim());
}

/**
 * 아카이브 URL → parseGitUrl 동형 pseudo owner/repo.
 * ArchiveFetcher 는 owner/repo 인자를 무시하므로 식별용 안정 값만 제공한다.
 */
export function archivePseudoRepo(url: string): { owner: string; repo: string } {
    const hash = crypto.createHash('sha256').update(url.trim()).digest('hex').slice(0, 12);
    return { owner: 'archive', repo: hash };
}

export interface ArchiveFetcherLimits {
    /** 압축 파일 자체 크기 상한 (bytes) */
    maxArchiveBytes: number;
    /** 엔트리 수 상한 */
    maxEntries: number;
    /** 해제 후 총 크기 상한 (bytes) */
    maxTotalBytes: number;
}

export class ArchiveFetcher {
    private loaded: Promise<{ sha: string; files: Map<string, Uint8Array> }> | null = null;

    constructor(
        private url: string,
        private limits: ArchiveFetcherLimits,
    ) {}

    private load(): Promise<{ sha: string; files: Map<string, Uint8Array> }> {
        if (!this.loaded) this.loaded = this.doLoad();
        return this.loaded;
    }

    private async doLoad(): Promise<{ sha: string; files: Map<string, Uint8Array> }> {
        const res = await safeFetch(this.url);
        if (!res.ok) throw new Error(`ARCHIVE_FETCH_FAIL: ${res.status} ${this.url}`);
        const declared = parseInt(res.headers.get('content-length') || '0', 10);
        if (declared > this.limits.maxArchiveBytes) {
            throw new Error(`ARCHIVE_TOO_LARGE: content-length ${declared} > ${this.limits.maxArchiveBytes}`);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > this.limits.maxArchiveBytes) {
            throw new Error(`ARCHIVE_TOO_LARGE: ${buf.byteLength} > ${this.limits.maxArchiveBytes}`);
        }
        const sha = crypto.createHash('sha256').update(buf).digest('hex');

        let raw: Record<string, Uint8Array>;
        try {
            raw = unzipSync(buf);
        } catch (e) {
            throw new Error(`ARCHIVE_INVALID: zip 해제 실패 — ${e instanceof Error ? e.message : String(e)}`);
        }

        // zip-slip/폭탄 방어 + 정규화
        const entries: Array<[string, Uint8Array]> = [];
        let total = 0;
        for (const [path, data] of Object.entries(raw)) {
            if (path.endsWith('/')) continue;                       // 디렉토리 엔트리
            if (path.includes('..') || path.startsWith('/')) continue;  // zip-slip
            total += data.byteLength;
            if (total > this.limits.maxTotalBytes) {
                throw new Error(`ARCHIVE_TOO_LARGE: 해제 총 크기 > ${this.limits.maxTotalBytes} (압축 폭탄 의심)`);
            }
            entries.push([path, data]);
            if (entries.length > this.limits.maxEntries) {
                throw new Error(`ARCHIVE_TOO_MANY_ENTRIES: > ${this.limits.maxEntries}`);
            }
        }
        if (entries.length === 0) throw new Error('ARCHIVE_EMPTY: zip 에 파일 없음');

        // 공통 최상위 디렉토리 1겹 제거 (GitHub 소스 zip: repo-ref/ 래핑)
        const roots = new Set(entries.map(([p]) => p.split('/')[0]));
        const allWrapped = roots.size === 1 && entries.every(([p]) => p.includes('/'));
        const files = new Map<string, Uint8Array>();
        for (const [p, data] of entries) {
            files.set(allWrapped ? p.slice(p.indexOf('/') + 1) : p, data);
        }
        logger.info(`archive loaded: ${this.url} (${buf.byteLength}B, ${files.size} files, sha=${sha.slice(0, 8)})`);
        return { sha, files };
    }

    /** GitFetcher 동형 — ref 인자는 무시 (아카이브는 단일 스냅샷), sha256 을 ref 로 반환. */
    async resolveRef(_owner: string, _repo: string, _ref?: string): Promise<string> {
        const { sha } = await this.load();
        return sha;
    }

    /** GitFetcher 동형 — zip 엔트리 목록. */
    async listTree(_owner: string, _repo: string, _sha: string, maxEntries: number = 10_000): Promise<TreeResult> {
        const { sha, files } = await this.load();
        const entries: TreeEntry[] = [];
        for (const [path, data] of files) {
            entries.push({ path, sha: '', size: data.byteLength, type: 'blob' });
            if (entries.length > maxEntries) throw new Error(`ARCHIVE_TOO_MANY_ENTRIES: > ${maxEntries}`);
        }
        return { sha, entries, truncated: false, rateLimitRemaining: -1 };
    }

    /** GitFetcher 동형 — 엔트리 텍스트 반환. */
    async fetchFile(_owner: string, _repo: string, _sha: string, path: string, maxBytes?: number): Promise<string> {
        const { files } = await this.load();
        const data = files.get(path);
        if (!data) throw new Error(`ARCHIVE_FILE_NOT_FOUND: ${path}`);
        if (maxBytes && data.byteLength > maxBytes) {
            throw new Error(`ARCHIVE_FILE_TOO_LARGE: ${path} (${data.byteLength} > ${maxBytes})`);
        }
        return Buffer.from(data).toString('utf-8');
    }
}
