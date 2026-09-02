/** chatWithAbortTimeout — 스로틀된 외부 클라이언트는 타임아웃 배수 적용 (2026-09-03 bai 청크 abort 후속) */
import { chatWithAbortTimeout } from '../chat-with-timeout';
import { EXTERNAL_CLIENT_HINTS } from '../../../llm/external-throttle';
import type { LLMClient } from '../../../llm/client';

function clientWithHints(mult: number | null) {
    const c: Record<string | symbol, unknown> = {
        chat: async (_m: unknown, _o: unknown, _t: unknown, adv: { signal: AbortSignal }) => new Promise((resolve, reject) => {
            adv.signal.addEventListener('abort', () => reject(new Error('Request was aborted.')));
            setTimeout(() => resolve({ role: 'assistant', content: 'ok' }), 60);
        }),
    };
    if (mult !== null) c[EXTERNAL_CLIENT_HINTS] = { providerId: 'bai', concurrency: 1, timeoutMultiplier: mult };
    return c as unknown as LLMClient;
}

describe('chatWithAbortTimeout × external hints', () => {
    it('힌트 없음: 30ms 타임아웃이면 60ms 응답은 abort', async () => {
        await expect(chatWithAbortTimeout(clientWithHints(null), [], {}, 30)).rejects.toThrow(/aborted/);
    });
    it('배수 3: 30ms×3=90ms 안에 60ms 응답이 들어와 성공', async () => {
        await expect(chatWithAbortTimeout(clientWithHints(3), [], {}, 30)).resolves.toMatchObject({ content: 'ok' });
    });
    it('외부 signal 이 이미 abort 면 호출 없이 RESEARCH_ABORTED', async () => {
        const ac = new AbortController(); ac.abort();
        await expect(chatWithAbortTimeout(clientWithHints(3), [], {}, 30, ac.signal)).rejects.toThrow('RESEARCH_ABORTED');
    });
});
