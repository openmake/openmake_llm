import { SkillCreatorService } from '../skill-creator';
import { Pool } from 'pg';
import type { LLMClient } from '../../llm/client';

describe('SkillCreatorService', () => {
    const mockLLM = { chat: jest.fn() } as unknown as Pick<LLMClient, 'chat'>;
    const mockPool = { query: jest.fn() } as unknown as Pool;
    let svc: SkillCreatorService;

    beforeEach(() => {
        jest.clearAllMocks();
        svc = new SkillCreatorService({
            pool: mockPool,
            llmClientFactory: () => mockLLM as LLMClient,
        });
    });

    function llmResponse(manifest: object) {
        return { role: 'assistant', content: JSON.stringify(manifest), metrics: { completion_tokens: 100 } };
    }

    it('happy path: LLM returns valid JSON → row INSERT', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce(llmResponse({
            name: '한국 의료법 자문',
            description: '의료기기법, 약사법, 임상시험 규정 자문',
            category: 'legal',
            content: 'A'.repeat(500),
            triggers: ['의료법'],
            tags: ['legal', 'korea'],
        }));
        (mockPool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] })             // dedupe lookup (no existing)
            .mockResolvedValueOnce({ rows: [{ count: '0' }] }) // draft count
            .mockResolvedValueOnce({ rows: [] });             // INSERT

        const result = await svc.create({
            userId: 'user-1',
            isAdmin: false,
            purpose: '한국 의료법 전문 스킬 만들어줘',
        });

        expect(result.skillId).toMatch(/^user-skill-/);
        expect(result.target).toBe('user');
        expect(mockLLM.chat).toHaveBeenCalledTimes(1);
    });

    it('target=system + non-admin → soft-fail to user', async () => {
        (mockLLM.chat as jest.Mock).mockResolvedValueOnce(llmResponse({
            name: 'X 분야 스킬',
            description: 'desc 10 chars long',
            category: 'general',
            content: 'A'.repeat(500),
            triggers: [],
            tags: [],
        }));
        (mockPool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await svc.create({
            userId: 'user-1',
            isAdmin: false,
            purpose: '시스템 스킬 만들어줘',
            target: 'system',
        });

        expect(result.target).toBe('user');
        expect(result.warnings).toContain('ADMIN_REQUIRED');
    });

    it('LLM returns invalid JSON → retry once', async () => {
        (mockLLM.chat as jest.Mock)
            .mockResolvedValueOnce({ role: 'assistant', content: 'not json at all', metrics: { completion_tokens: 5 } })
            .mockResolvedValueOnce(llmResponse({
                name: 'OK 스킬', description: 'valid description here', category: 'general',
                content: 'A'.repeat(500), triggers: [], tags: [],
            }));
        (mockPool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] })
            .mockResolvedValueOnce({ rows: [] });

        const result = await svc.create({
            userId: 'user-1', isAdmin: false, purpose: '재시도 테스트 prompt',
        });

        expect(mockLLM.chat).toHaveBeenCalledTimes(2);
        expect(result.skillId).toMatch(/^user-skill-/);
    });

    it('LLM fails twice → throws LLM_PARSE_FAIL', async () => {
        (mockLLM.chat as jest.Mock)
            .mockResolvedValueOnce({ role: 'assistant', content: 'invalid 1', metrics: { completion_tokens: 3 } })
            .mockResolvedValueOnce({ role: 'assistant', content: 'invalid 2', metrics: { completion_tokens: 3 } });
        (mockPool.query as jest.Mock)
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [{ count: '0' }] });

        await expect(
            svc.create({ userId: 'user-1', isAdmin: false, purpose: '실패 prompt 입력' })
        ).rejects.toThrow(/LLM_PARSE_FAIL/);
    });

    it('dedupe: same promptHash within 24h → returns existing draft', async () => {
        (mockPool.query as jest.Mock).mockResolvedValueOnce({
            rows: [{
                id: 'user-skill-existing',
                name: '이미 있음',
                description: '...',
                category: 'legal',
                content: 'X'.repeat(500),
                manifest_meta: {
                    version: '1.0', source: 'auto-llm', model: 'm', modelTier: 'system',
                    createdAt: new Date().toISOString(), promptHash: 'sha256:any',
                    userPrompt: '...', triggers: ['t'], tags: [], tokensUsed: 100,
                },
            }],
        });

        const result = await svc.create({
            userId: 'user-1', isAdmin: false, purpose: '동일 prompt 입력',
        });

        expect(result.skillId).toBe('user-skill-existing');
        expect(result.deduped).toBe(true);
        expect(mockLLM.chat).not.toHaveBeenCalled();
    });
});
