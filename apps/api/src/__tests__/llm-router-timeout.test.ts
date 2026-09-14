/**
 * routeWithLLM 타임아웃·출력 형식 회귀 테스트 (2026-09-15).
 *
 * 배경: 로컬 모델이 dense 27B 로 바뀐 뒤 라우터 응답(사유 문장 + 대안 목록, 약 100토큰)이 5초 타임아웃을
 * 넘겨 09-02 이후 211회 전부 폴백됐고, 타임아웃 뒤에도 요청을 끊지 않아 GPU 에서 계속 디코드됐다.
 * 출력은 agent_id·confidence 로 줄이고(실측 6.4s → 2.0s), 타임아웃 시 upstream 요청을 abort 한다.
 */
const mockChat = jest.fn();
jest.mock('../llm', () => ({
    LLMClient: jest.fn().mockImplementation(() => ({ chat: mockChat })),
}));

import { routeWithLLM } from '../agents/llm-router';
import { buildLLMRouterSystemPrompt } from '../prompts/llm-router-system';

describe('routeWithLLM', () => {
    beforeEach(() => mockChat.mockReset());

    it('타임아웃이면 null 을 돌려주고 upstream 요청을 abort 한다', async () => {
        let seenSignal: AbortSignal | undefined;
        mockChat.mockImplementation((_m: unknown, _o: unknown, _cb: unknown, adv: { signal?: AbortSignal }) => {
            seenSignal = adv.signal;
            return new Promise((_resolve, reject) => {
                adv.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            });
        });

        const result = await routeWithLLM('직장에서 상사가 연차를 못 쓰게 하는데 어떻게 대응해야 할까요?', 20);

        expect(result).toBeNull();
        expect(seenSignal?.aborted).toBe(true);
    });

    it('agent_id·confidence 만 온 축소 응답도 라우팅 결과로 받는다', async () => {
        mockChat.mockResolvedValue({ content: '{"agent_id": "labor-lawyer", "confidence": 0.95}' });

        const result = await routeWithLLM('직장에서 상사가 연차를 못 쓰게 하는데 어떻게 대응해야 할까요?', 1000);

        expect(result).toEqual({ agentId: 'labor-lawyer', confidence: 0.95, reasoning: '', alternativeAgents: [] });
    });

    it('타임아웃 전에 난 오류는 폴백(null)으로 흡수한다', async () => {
        mockChat.mockRejectedValue(new Error('upstream 500'));
        await expect(routeWithLLM('직장에서 상사가 연차를 못 쓰게 하는데 어떻게 대응해야 할까요?', 1000)).resolves.toBeNull();
    });
});

describe('buildLLMRouterSystemPrompt — 출력 형식', () => {
    it('디코드 예산을 잡아먹는 사유·대안 필드를 요구하지 않는다', () => {
        const prompt = buildLLMRouterSystemPrompt('- **general**: 범용 - 설명');
        expect(prompt).toContain('"agent_id"');
        expect(prompt).toContain('"confidence"');
        expect(prompt).not.toContain('"reasoning"');
        expect(prompt).not.toContain('"alternatives"');
    });
});
