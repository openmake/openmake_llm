/**
 * GitHub 게시자 — 번들 파일을 새 브랜치에 커밋하고 PR 을 연다 (Git Data API).
 *
 * main 에 직접 push 하지 않는다. 마켓플레이스 레포의 규칙("재검증 후 커밋")을 사람이 PR 리뷰로
 * 잡는다. marketplace.json 은 base 커밋의 것을 읽어 엔트리를 merge 한 뒤 같은 커밋에 넣는다
 * (같은 이름이 있으면 교체 — 재게시 = 갱신).
 *
 * 외부 호출은 전부 `createPinnedFetch`(SSRF 가드). 토큰은 호출자가 넘긴다(요청 body 우선, env 폴백).
 *
 * @module services/marketplace/github-publisher
 */
import { createPinnedFetch } from '../../security/ssrf-guard';
import { MARKETPLACE_PATHS } from '../../config/marketplace-publish';
import type { BundleFile } from './plugin-bundle-builder';
import { createLogger } from '../../utils/logger';

const logger = createLogger('GithubPublisher');
const API = 'https://api.github.com';

export interface PublishInput {
    owner: string;
    repo: string;
    token: string;
    files: BundleFile[];
    marketplaceEntry: { name: string; description: string; category: string; source: string };
    branchName: string;
    commitMessage: string;
    prTitle: string;
    prBody: string;
    baseBranch?: string;
}

export interface PublishResult { branch: string; commitSha: string; prUrl: string; prNumber: number; files: string[] }

export class GithubPublisher {
    private readonly fetch = createPinnedFetch();

    constructor(private readonly token: string) {}

    private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await this.fetch(`${API}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'openmake-llm-marketplace-publisher',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            const text = (await res.text()).slice(0, 300);
            throw new Error(`GitHub ${method} ${path} → ${res.status}: ${text}`);
        }
        return res.json() as Promise<T>;
    }

    async publish(input: PublishInput): Promise<PublishResult> {
        const { owner, repo } = input;
        const base = input.baseBranch ?? (await this.api<{ default_branch: string }>('GET', `/repos/${owner}/${repo}`)).default_branch;
        const ref = await this.api<{ object: { sha: string } }>('GET', `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
        const baseSha = ref.object.sha;
        const baseCommit = await this.api<{ tree: { sha: string } }>('GET', `/repos/${owner}/${repo}/git/commits/${baseSha}`);

        // marketplace.json merge — base 시점 내용을 읽어 같은 이름은 교체
        const idxPath = MARKETPLACE_PATHS.index;
        const idxRes = await this.api<{ content: string; encoding: string }>('GET', `/repos/${owner}/${repo}/contents/${idxPath}?ref=${baseSha}`);
        const index = JSON.parse(Buffer.from(idxRes.content, 'base64').toString('utf8')) as { plugins: Array<{ name: string }> };
        const plugins = index.plugins.filter((p) => p.name !== input.marketplaceEntry.name);
        plugins.push(input.marketplaceEntry);
        const indexText = JSON.stringify({ ...index, plugins }, null, 2) + '\n';

        // blobs → tree → commit → ref → PR
        const allFiles: BundleFile[] = [...input.files, { path: idxPath, content: indexText }];
        const treeEntries = [];
        for (const f of allFiles) {
            const isBuf = Buffer.isBuffer(f.content);
            const blob = await this.api<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/blobs`, {
                content: isBuf ? (f.content as Buffer).toString('base64') : f.content,
                encoding: isBuf ? 'base64' : 'utf-8',
            });
            treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const tree = await this.api<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/trees`, { base_tree: baseCommit.tree.sha, tree: treeEntries });
        const commit = await this.api<{ sha: string }>('POST', `/repos/${owner}/${repo}/git/commits`, { message: input.commitMessage, tree: tree.sha, parents: [baseSha] });
        await this.api('POST', `/repos/${owner}/${repo}/git/refs`, { ref: `refs/heads/${input.branchName}`, sha: commit.sha });
        const pr = await this.api<{ html_url: string; number: number }>('POST', `/repos/${owner}/${repo}/pulls`, {
            title: input.prTitle, head: input.branchName, base, body: input.prBody,
        });
        logger.info(`게시 PR 생성: ${pr.html_url} (${allFiles.length} files)`);
        return { branch: input.branchName, commitSha: commit.sha, prUrl: pr.html_url, prNumber: pr.number, files: allFiles.map((f) => f.path) };
    }
}
