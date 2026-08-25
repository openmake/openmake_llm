/**
 * 내부 번들 페처 — `internal://bundle/<id>` 소스를 DB(marketplace_bundles) 에서 읽는다.
 *
 * 확장 ingest 는 fetcher 를 duck-typed(GitFetcher 동형)로 쓰므로, 이 클래스를 끼우면 git·zip 과
 * 같은 파이프라인(매니페스트 검증 → 스킬/에이전트/MCP 변환 → draft → 승인)을 그대로 탄다.
 * ArchiveFetcher 와 같은 "ref 없는 내용 해시" 모델이다: resolveRef 는 번들 sha, 업데이트 판정은 sha 비교.
 *
 * 네트워크를 타지 않으므로 SSRF 가드 대상이 아니다. owner 검증은 여기서 하지 않는다 — 갤러리에
 * 공유(visibility=shared)된 번들만 설치 대상이 되며, 그 판정은 컨트롤러(getInstallableById)가 한다.
 *
 * @module agents/git-ingest/internal-bundle-fetcher
 */
import type { TreeEntry, TreeResult } from './git-fetcher';
import { isArchiveUrl, archivePseudoRepo } from './archive-fetcher';

export const INTERNAL_BUNDLE_PREFIX = 'internal://bundle/';

export function isInternalBundleUrl(url: string): boolean {
    return url.trim().startsWith(INTERNAL_BUNDLE_PREFIX);
}

export function internalBundleId(url: string): string {
    return url.trim().slice(INTERNAL_BUNDLE_PREFIX.length).replace(/[^A-Za-z0-9_-]/g, '');
}

export function internalBundlePseudoRepo(url: string): { owner: string; repo: string } {
    return { owner: 'internal', repo: internalBundleId(url) };
}

/** git 이 아닌 소스(zip 아카이브 · 내부 번들) — ingest 분기 공통 판정 */
export function isNonGitSourceUrl(url: string): boolean {
    return isArchiveUrl(url) || isInternalBundleUrl(url);
}

export function nonGitPseudoRepo(url: string): { owner: string; repo: string } {
    return isInternalBundleUrl(url) ? internalBundlePseudoRepo(url) : archivePseudoRepo(url);
}

export interface LoadedBundle { sha: string; files: Map<string, Uint8Array> }

export class InternalBundleFetcher {
    private loaded: Promise<LoadedBundle> | null = null;

    constructor(
        private readonly url: string,
        private readonly loadBundle: (id: string) => Promise<LoadedBundle | null>,
    ) {}

    private load(): Promise<LoadedBundle> {
        if (!this.loaded) {
            this.loaded = (async () => {
                const b = await this.loadBundle(internalBundleId(this.url));
                if (!b) throw new Error(`INTERNAL_BUNDLE_NOT_FOUND: ${this.url}`);
                return b;
            })();
        }
        return this.loaded;
    }

    async resolveRef(_owner: string, _repo: string, _ref?: string): Promise<string> {
        return (await this.load()).sha;
    }

    async getDefaultBranch(_owner: string, _repo: string): Promise<string> {
        return 'bundle';
    }

    async listTree(_owner: string, _repo: string, _sha: string, maxEntries: number = 10_000): Promise<TreeResult> {
        const { sha, files } = await this.load();
        const entries: TreeEntry[] = [];
        for (const [path, data] of files) {
            entries.push({ path, sha: '', size: data.byteLength, type: 'blob' });
            if (entries.length > maxEntries) throw new Error(`INTERNAL_BUNDLE_TOO_MANY_ENTRIES: > ${maxEntries}`);
        }
        return { sha, entries, truncated: false, rateLimitRemaining: -1 };
    }

    async fetchFile(_owner: string, _repo: string, _sha: string, path: string, maxBytes?: number): Promise<string> {
        const { files } = await this.load();
        const data = files.get(path);
        if (!data) throw new Error(`INTERNAL_BUNDLE_FILE_NOT_FOUND: ${path}`);
        if (maxBytes && data.byteLength > maxBytes) throw new Error(`INTERNAL_BUNDLE_FILE_TOO_LARGE: ${path} (${data.byteLength} > ${maxBytes})`);
        return Buffer.from(data).toString('utf-8');
    }
}
