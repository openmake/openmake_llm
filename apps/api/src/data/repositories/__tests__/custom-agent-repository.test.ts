import { Pool } from 'pg';
import { CustomAgentRepository } from '../custom-agent-repository';

jest.mock('../../retry-wrapper', () => ({ withRetry: (fn: () => unknown) => fn() }));

function makeMockPool() {
    return { query: jest.fn() } as unknown as Pool;
}

describe('CustomAgentRepository', () => {
    let pool: Pool;
    let repo: CustomAgentRepository;

    beforeEach(() => {
        pool = makeMockPool();
        repo = new CustomAgentRepository(pool);
    });

    it('insertDraft: agent id 자동 생성 + status=draft INSERT', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        const r = await repo.insertDraft({
            name: 'Legal',
            description: 'desc',
            systemPrompt: 'You are...',
            category: 'legal',
            emoji: '⚖️',
            keywords: ['법률'],
            temperature: 0.3,
            maxTokens: 4000,
            createdBy: 'user-1',
            manifestMeta: { source: 'git-url', gitUrl: 'foo/bar' },
        });
        expect(r.id).toMatch(/^custom-legal-/);
        expect(r.status).toBe('draft');
        expect(r.enabled).toBe(false);
        const sql = (pool.query as jest.Mock).mock.calls[0][0];
        expect(sql).toMatch(/INSERT INTO custom_agents/);
        expect(sql).toMatch(/status/);
        expect(sql).toMatch(/manifest_meta/);
    });

    it('listDrafts: status=draft + created_by 필터', async () => {
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [{ total: '2' }] })
            .mockResolvedValueOnce({ rows: [{
                id: 'custom-1', name: 'A', status: 'draft', created_by: 'user-1',
                manifest_meta: null, created_at: new Date(), updated_at: new Date(),
                description: null, system_prompt: '', keywords: null, category: null,
                emoji: null, temperature: null, max_tokens: null, enabled: false,
            }] });
        const r = await repo.listDrafts({ userId: 'user-1', limit: 50 });
        expect(r.total).toBe(2);
        expect(r.drafts).toHaveLength(1);
    });

    it('updateStatus: draft → active', async () => {
        const baseRow = {
            id: 'custom-1', status: 'draft' as const, created_by: 'user-1',
            name: 'A', description: null, system_prompt: '', keywords: null, category: null,
            emoji: null, temperature: null, max_tokens: null, enabled: false,
            manifest_meta: null, created_at: new Date(), updated_at: new Date(),
        };
        (pool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [baseRow] })
            .mockResolvedValueOnce({ rows: [] })  // UPDATE
            .mockResolvedValueOnce({ rows: [{ ...baseRow, status: 'active', enabled: true }] });
        const r = await repo.updateStatus('custom-1', 'active', { userId: 'user-1', userRole: 'user' });
        expect(r?.status).toBe('active');
        expect(r?.enabled).toBe(true);
    });

    it('updateStatus: 비소유자 + 비-admin → throws', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{
            id: 'custom-1', status: 'draft', created_by: 'user-A',
            name: 'A', description: null, system_prompt: '', keywords: null, category: null,
            emoji: null, temperature: null, max_tokens: null, enabled: false,
            manifest_meta: null, created_at: new Date(), updated_at: new Date(),
        }] });
        await expect(repo.updateStatus('custom-1', 'active', { userId: 'user-B', userRole: 'user' })).rejects.toThrow();
    });

    it('countDraftsForUser', async () => {
        (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [{ count: '5' }] });
        const c = await repo.countDraftsForUser('user-1');
        expect(c).toBe(5);
    });
});
