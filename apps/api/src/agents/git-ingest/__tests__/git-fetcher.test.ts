import { GitFetcher } from '../git-fetcher';

describe('GitFetcher', () => {
    const origFetch = global.fetch;
    let mockFetch: jest.Mock;

    beforeEach(() => {
        mockFetch = jest.fn();
        global.fetch = mockFetch as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = origFetch;
    });

    function mkHeaders(entries: Record<string, string> = {}): Headers {
        const h = new Headers();
        for (const [k, v] of Object.entries(entries)) h.set(k, v);
        return h;
    }

    it('resolveRef: branch → commit SHA', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => ({ object: { sha: 'abc123def456' } }),
            headers: mkHeaders({ 'x-ratelimit-remaining': '4999' }),
        });
        const f = new GitFetcher();
        const sha = await f.resolveRef('foo', 'bar', 'main');
        expect(sha).toBe('abc123def456');
    });

    it('resolveRef: hex SHA 는 API 호출 없이 그대로 반환', async () => {
        const f = new GitFetcher();
        const sha = await f.resolveRef('foo', 'bar', 'abc123d');
        expect(sha).toBe('abc123d');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('listTree: tree API 응답 파싱 (blob 만, tree 제외)', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            json: async () => ({
                sha: 'tree-sha',
                tree: [
                    { path: 'README.md', sha: 'b1', type: 'blob', size: 100 },
                    { path: 'skills/legal.SKILL.md', sha: 'b2', type: 'blob', size: 500 },
                    { path: 'skills', sha: 't1', type: 'tree' },
                ],
                truncated: false,
            }),
            headers: mkHeaders({ 'x-ratelimit-remaining': '4998' }),
        });
        const f = new GitFetcher();
        const tree = await f.listTree('foo', 'bar', 'abc123');
        expect(tree.entries).toHaveLength(2);
        expect(tree.entries[0].path).toBe('README.md');
        expect(tree.rateLimitRemaining).toBe(4998);
    });

    it('fetchFile: raw content 텍스트 반환', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true, status: 200,
            text: async () => '# Hello\n',
            headers: mkHeaders({ 'content-length': '8' }),
        });
        const f = new GitFetcher();
        const content = await f.fetchFile('foo', 'bar', 'abc123', 'README.md');
        expect(content).toBe('# Hello\n');
    });

    it('404 → throws REPO_NOT_FOUND', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 404, headers: mkHeaders() });
        const f = new GitFetcher();
        await expect(f.resolveRef('foo', 'missing', 'main')).rejects.toThrow(/REPO_NOT_FOUND/);
    });

    it('403 + rate-limit-remaining 0 → throws GITHUB_RATE_LIMITED', async () => {
        mockFetch.mockResolvedValueOnce({ ok: false, status: 403, headers: mkHeaders({ 'x-ratelimit-remaining': '0' }) });
        const f = new GitFetcher();
        await expect(f.resolveRef('foo', 'bar', 'main')).rejects.toThrow(/GITHUB_RATE_LIMITED/);
    });
});
