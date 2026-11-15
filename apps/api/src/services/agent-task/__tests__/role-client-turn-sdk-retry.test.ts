/**
 * 에이전트 작업 턴 파생은 앱 SDK 재시도 0 — 일시 오류 재시도는 턴 루프(TURN_RETRY_MAX + 복구 대기 + onRetry 관측) 한 층만 맡는다.
 * SDK 재시도가 그 아래에서 곱해지면 5xx 하나에 upstream 3×3 회가 된다. 실제로 값이 바뀌는 것은 로컬 클라이언트 파생뿐이다
 * (외부 API 키 클라이언트는 이미 0, OAuth 어댑터의 derive 는 자신을 돌려준다).
 */
import { LLMClient } from '../../../llm/client';
import { chatTurnWithRoleFallback, type AgentRoleState } from '../role-client';

describe('chatTurnWithRoleFallback — 턴 파생 SDK 재시도', () => {
    it('로컬 클라이언트를 maxRetries: 0 으로 파생해 턴을 호출한다', async () => {
        const client = new LLMClient({ model: 'm' });
        const chat = jest.fn(async () => ({ role: 'assistant', content: 'ok' }));
        const derive = jest.spyOn(client, 'derive').mockReturnValue({ chat } as unknown as LLMClient);
        const state: AgentRoleState = { client, external: false, fallbackDone: false };
        await chatTurnWithRoleFallback(state, {
            conversation: [{ role: 'user', content: 'u' }], tools: [], signal: new AbortController().signal, taskId: 't1', userId: 'u1',
        });
        expect(derive).toHaveBeenCalledTimes(1);
        expect(derive.mock.calls[0][0]).toMatchObject({ maxRetries: 0 });
        expect(chat).toHaveBeenCalledTimes(1);
    });
});
