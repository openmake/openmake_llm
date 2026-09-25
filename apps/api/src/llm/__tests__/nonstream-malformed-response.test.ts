/**
 * nonStreamChat — 200 인데 choices 가 없는 upstream 본문은 TypeError 가 아니라
 * 재시도 가능한 MalformedLLMResponseError(502)로 올라와야 한다 (2026-09-25 hasa:qwen3-coder 간헐 실패).
 */
import type OpenAI from 'openai';
import { nonStreamChat } from '../stream-parser';
import { MalformedLLMResponseError } from '../../errors/malformed-llm-response.error';
import { isTransientLLMError } from '../../services/agent-task/role-client';

function fakeClient(body: unknown): OpenAI {
    return { chat: { completions: { create: jest.fn().mockResolvedValue(body) } } } as unknown as OpenAI;
}

const request = { model: 'hasa:qwen3-coder', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('nonStreamChat — choices 누락 응답', () => {
    it('upstream 오류 객체는 MalformedLLMResponseError 로 던지고 본문을 메시지에 싣는다', async () => {
        const err = await nonStreamChat(fakeClient({ error: { message: 'upstream overloaded' } }), request)
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(MalformedLLMResponseError);
        expect((err as Error).message).toContain('upstream overloaded');
        expect((err as Error).message).toContain('hasa:qwen3-coder');
    });

    it('턴 재시도가 일시적 오류로 판정한다(502)', async () => {
        const err = await nonStreamChat(fakeClient({}), request).catch((e: unknown) => e);
        expect(isTransientLLMError(err)).toBe(true);
    });

    it('정상 응답은 그대로 파싱한다', async () => {
        const out = await nonStreamChat(fakeClient({
            choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 3, completion_tokens: 1 },
        }), request);
        expect(out.content).toBe('OK');
    });
});
