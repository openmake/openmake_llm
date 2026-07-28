import { AgentIngestService } from '../agent-ingest-service';
import type { Pool } from 'pg';
import type { LLMClient } from '../../../llm/client';
import { GitFetcher } from '../git-fetcher';

jest.mock('../../../data/retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

describe('AgentIngestService', () => {
    const mockPool = { query: jest.fn() } as unknown as Pool;
    const mockLLM = { chat: jest.fn() } as unknown as Pick<LLMClient, 'chat'>;
    let mockFetcher: jest.Mocked<Pick<GitFetcher, 'resolveRef' | 'listTree' | 'fetchFile'>>;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFetcher = { resolveRef: jest.fn(), listTree: jest.fn(), fetchFile: jest.fn() };
    });

    function makeService() {
        return new AgentIngestService({
            pool: mockPool,
            llmClientFactory: () => mockLLM as LLMClient,
            fetcherFactory: () => mockFetcher as unknown as GitFetcher,
        });
    }

    const validAgentMd = `---
type: agent
name: Legal Advisor
description: 한국 법률 자문 전문가
category: legal
emoji: '⚖️'
keywords: [법률]
skill_bindings:
  - skill-id:user-skill-existing
version: '1.0.0'
---

You are a legal advisor with deep knowledge of Korean administrative law.`;

    it('happy path: 단일 AGENT.md ingest', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [{ path: 'AGENT.md', sha: 'd', size: 600, type: 'blob' }],
            truncated: false, rateLimitRemaining: 4999,
        });
        mockFetcher.fetchFile.mockResolvedValueOnce(validAgentMd);
        // skill-id lookup
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ id: 'user-skill-existing' }] });
        // ConventionChecker LLM
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }), metrics: { completion_tokens: 30 },
        });
        // dedupe (no existing)
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        // draft count
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] });
        // INSERT custom_agents
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        // INSERT agent_skill_assignments
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

        const svc = makeService();
        const r = await svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar' });
        if ('selectionRequired' in r && r.selectionRequired) throw new Error('expected single');
        expect(r.agentId).toMatch(/^custom-legal-/);
        expect(r.status).toBe('draft');
        expect(r.skillBindingsResolved).toHaveLength(1);
        expect(r.skillBindingsResolved[0].resolved).toBe(true);
    });

    it('skill-id 가 DB 에 없으면 unresolved 로 분류 (실패는 아님)', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [{ path: 'AGENT.md', sha: 'd', size: 600, type: 'blob' }],
            truncated: false, rateLimitRemaining: 4999,
        });
        mockFetcher.fetchFile.mockResolvedValueOnce(
            validAgentMd.replace('user-skill-existing', 'user-skill-missing')
        );
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });  // skill-id lookup fail
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce({
            content: JSON.stringify({ findings: [] }), metrics: { completion_tokens: 30 },
        });
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });  // dedupe
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '0' }] });  // draft count
        (mockPool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });  // INSERT

        const svc = makeService();
        const r = await svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar' });
        if ('selectionRequired' in r && r.selectionRequired) throw new Error('expected single');
        expect(r.skillBindingsUnresolved).toHaveLength(1);
        expect(r.skillBindingsResolved).toHaveLength(0);
        expect(r.validationWarnings).toContain('SKILL_BINDING_UNRESOLVED');
    });

    it('NO_AGENT_FOUND: tree 에 후보 0개', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [{ path: 'README.md', sha: 'x', size: 100, type: 'blob' }],
            truncated: false, rateLimitRemaining: 4999,
        });
        const svc = makeService();
        await expect(svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar' })).rejects.toThrow(/NO_AGENT_FOUND/);
    });

    it('multi-candidate: gitPath 미지정 + 여러 후보 → selectionRequired', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [
                { path: 'agents/legal.AGENT.md', sha: 's1', size: 500, type: 'blob' },
                { path: 'agents/medical.AGENT.md', sha: 's2', size: 500, type: 'blob' },
            ],
            truncated: false, rateLimitRemaining: 4999,
        });
        const svc = makeService();
        const r = await svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar' });
        if (!('selectionRequired' in r) || !r.selectionRequired) throw new Error('expected multi');
        expect(r.candidates).toHaveLength(2);
    });

    it('INVALID_AGENT_MANIFEST: type=skill 잘못 지정', async () => {
        mockFetcher.resolveRef.mockResolvedValueOnce('abc123');
        mockFetcher.listTree.mockResolvedValueOnce({
            sha: 'abc123',
            entries: [{ path: 'AGENT.md', sha: 'd', size: 600, type: 'blob' }],
            truncated: false, rateLimitRemaining: 4999,
        });
        mockFetcher.fetchFile.mockResolvedValueOnce(validAgentMd.replace('type: agent', 'type: skill'));
        const svc = makeService();
        await expect(svc.import({ userId: 'user-1', isAdmin: false, gitUrl: 'foo/bar' })).rejects.toThrow(/INVALID_AGENT_MANIFEST/);
    });
});
