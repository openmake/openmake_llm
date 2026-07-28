import { GitIngestService } from '../git-ingest-service';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../llm/client';
import { GitFetcher } from '../git-fetcher';

describe('GitIngestService', () => {
    const mockPool = { query: jest.fn() } as unknown as Pool;
    const mockLLM = { chat: jest.fn() } as unknown as Pick<LLMClient, 'chat'>;
    let mockFetcher: jest.Mocked<Pick<GitFetcher, 'resolveRef' | 'listTree' | 'fetchFile'>>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFetcher = {
            resolveRef: jest.fn(),
            listTree: jest.fn(),
            fetchFile: jest.fn(),
        };
    });

    function makeService() {
        return new GitIngestService({
            pool: mockPool,
            llmClientFactory: () => mockLLM as LLMClient,
            fetcherFactory: () => mockFetcher as unknown as GitFetcher,
        });
    }

    // tool_bindings/mcp_bundles 필수 — manifest-validator 가 요구
    const validSkillMd = `---
name: Legal Skill
description: 한국 법률 자문 — 행정심판/행정소송 절차 안내
category: legal
version: '1.0.0'
tool_bindings: []
mcp_bundles: []
---

# Legal

This is a test skill body for unit testing.`;

    it('happy path: 단일 SKILL.md ingest', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [{ path: 'SKILL.md', sha: 'def456', size: 500, type: 'blob' }],
            truncated: false,
            rateLimitRemaining: 4999,
        });
        mockFetcher.fetchFile.mockResolvedValueOnce(validSkillMd);
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }),
            metrics: { completion_tokens: 40 },
        });
        (mockPool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] })                  // dedupe lookup (no existing)
            .mockResolvedValueOnce({ rows: [{ count: '0' }] })    // draft count
            .mockResolvedValueOnce({ rows: [] });                  // INSERT

        const svc = makeService();
        const r = await svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar', target: 'user' });
        if ('selectionRequired' in r && r.selectionRequired) throw new Error('expected single, got multi');
        expect(r.skillId).toMatch(/^user-skill-/);
        expect(r.source).toBe('git-url');
        expect(r.gitRef).toBe('abc123');
        expect(r.conventionFindings).toEqual([]);
    });

    it('multi-candidate mode: gitPath 미지정 + 여러 후보 → selectionRequired', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [
                { path: 'legal.SKILL.md', sha: 's1', size: 500, type: 'blob' },
                { path: 'medical.SKILL.md', sha: 's2', size: 500, type: 'blob' },
            ],
            truncated: false, rateLimitRemaining: 4999,
        });

        const svc = makeService();
        const r = await svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar', target: 'user' });
        if (!('selectionRequired' in r) || !r.selectionRequired) throw new Error('expected multi');
        expect(r.candidates).toHaveLength(2);
        expect(r.totalCandidates).toBe(2);
    });

    it('INVALID_GIT_URL: parseGitUrl 실패', async () => {
        const svc = makeService();
        await expect(svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'not a url', target: 'user' }))
            .rejects.toThrow(/INVALID_GIT_URL/);
    });

    it('NO_SKILL_FOUND: tree 에 후보 0개', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123', entries: [{ path: 'README.md', sha: 'x', size: 100, type: 'blob' }],
            truncated: false, rateLimitRemaining: 4999,
        });
        const svc = makeService();
        await expect(svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar', target: 'user' }))
            .rejects.toThrow(/NO_SKILL_FOUND/);
    });

    it('target=system + 비-admin → soft-fail to user + ADMIN_REQUIRED warning', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [{ path: 'SKILL.md', sha: 'd', size: 500, type: 'blob' }],
            truncated: false, rateLimitRemaining: 4999,
        });
        mockFetcher.fetchFile.mockResolvedValueOnce(validSkillMd);
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }), metrics: { completion_tokens: 10 },
        });
        (mockPool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] })
            .mockResolvedValueOnce({ rows: [] });

        const svc = makeService();
        const r = await svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar', target: 'system' });
        if ('selectionRequired' in r && r.selectionRequired) throw new Error('expected single');
        expect(r.target).toBe('user');
        expect(r.validationWarnings).toContain('ADMIN_REQUIRED');
    });
});
