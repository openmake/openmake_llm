/**
 * GitHub REST API client for Skill ingest.
 *
 * - resolveRef(): branch/tag → commit SHA
 * - listTree(): tree API → blob 엔트리 배열
 * - fetchFile(): raw content (text only)
 *
 * @module agents/git-ingest/git-fetcher
 */
import { createLogger } from '../../utils/logger';

const logger = createLogger('GitFetcher');

const GITHUB_API = 'https://api.github.com';

export interface TreeEntry {
    path: string;
    sha: string;
    size: number;
    type: 'blob' | 'tree';
}

export interface TreeResult {
    sha: string;
    entries: TreeEntry[];
    truncated: boolean;
    rateLimitRemaining: number;
}

/**
 * Headers (real fetch) 또는 Map (test mock) 양쪽에서 안전하게 헤더 추출.
 */
function readHeader(headers: unknown, name: string): string {
    const h = headers as { get?: (n: string) => string | null };
    if (typeof h?.get === 'function') {
        return h.get(name) ?? '';
    }
    return '';
}

export class GitFetcher {
    constructor(private opts: { accessToken?: string; timeoutMs?: number } = {}) {}

    private async req(path: string): Promise<Response> {
        const headers: Record<string, string> = {
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (this.opts.accessToken) headers['Authorization'] = `Bearer ${this.opts.accessToken}`;
        const timeout = this.opts.timeoutMs ?? 30_000;
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeout);
        try {
            const res = await fetch(`${GITHUB_API}${path}`, { headers, signal: controller.signal });
            const rem = readHeader(res.headers, 'x-ratelimit-remaining');
            if (res.status === 404) throw new Error(`REPO_NOT_FOUND: ${path}`);
            if (res.status === 403 && rem === '0') {
                throw new Error(`GITHUB_RATE_LIMITED: limit reset at ${readHeader(res.headers, 'x-ratelimit-reset') || '?'}`);
            }
            if (!res.ok) throw new Error(`UPSTREAM_FETCH_FAIL: ${res.status} ${path}`);
            return res;
        } finally { clearTimeout(tid); }
    }

    /** branch/tag/SHA → 완전한 commit SHA. 7+ chars hex 면 그대로 반환 (GitHub 자동 확장). */
    async resolveRef(owner: string, repo: string, ref: string): Promise<string> {
        if (/^[0-9a-f]{7,40}$/i.test(ref)) return ref;
        // GitHub API 는 `/git/refs/heads/HEAD` 를 인식 못 함 (404). HEAD 면 default_branch 조회 후 그 이름으로 재시도.
        const effectiveRef = ref === 'HEAD' || !ref ? await this.getDefaultBranch(owner, repo) : ref;
        const res = await this.req(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(effectiveRef)}`);
        const data = await res.json() as { object?: { sha: string } };
        if (!data.object?.sha) throw new Error(`INVALID_REF: ${ref}`);
        return data.object.sha;
    }

    /** 저장소의 default branch (예: main, master) 이름 조회 */
    async getDefaultBranch(owner: string, repo: string): Promise<string> {
        const res = await this.req(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
        const data = await res.json() as { default_branch?: string };
        if (!data.default_branch) throw new Error(`NO_DEFAULT_BRANCH: ${owner}/${repo}`);
        return data.default_branch;
    }

    /** 저장소 전체 tree (blob entries only) */
    async listTree(owner: string, repo: string, sha: string): Promise<TreeResult> {
        const res = await this.req(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
        const data = await res.json() as { sha: string; tree: Array<{ path: string; sha: string; size?: number; type: string }>; truncated: boolean };
        const entries: TreeEntry[] = (data.tree || [])
            .filter(e => e.type === 'blob')
            .map(e => ({ path: e.path, sha: e.sha, size: e.size ?? 0, type: 'blob' as const }));
        const rem = parseInt(readHeader(res.headers, 'x-ratelimit-remaining') || '0', 10) || 0;
        if (data.truncated) logger.warn(`tree truncated: ${owner}/${repo}@${sha} (${entries.length} entries)`);
        return { sha: data.sha, entries, truncated: data.truncated, rateLimitRemaining: rem };
    }

    /** raw content (UTF-8 text) — binary 미지원, maxBytes 초과 시 throw */
    async fetchFile(owner: string, repo: string, sha: string, path: string, maxBytes: number = 256 * 1024): Promise<string> {
        const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(sha)}/${path.split('/').map(encodeURIComponent).join('/')}`;
        const headers: Record<string, string> = {};
        if (this.opts.accessToken) headers['Authorization'] = `Bearer ${this.opts.accessToken}`;
        const res = await fetch(rawUrl, { headers });
        if (!res.ok) throw new Error(`UPSTREAM_FETCH_FAIL: ${res.status} ${rawUrl}`);
        const cl = parseInt(readHeader(res.headers, 'content-length') || '0', 10);
        if (cl > maxBytes) throw new Error(`FILE_TOO_LARGE: ${cl} > ${maxBytes} (${path})`);
        return await res.text();
    }
}
