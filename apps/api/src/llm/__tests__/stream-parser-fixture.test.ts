/**
 * 스트림 파서 — 가짜 LLM 서버(실제 HTTP·SSE) + 실제 openai SDK 로 검증한다.
 * 청크 경계에 걸친 태그·인자, 스트림 도중 끊김, HTTP 오류가 재시도 분류(isTransientLLMError)와 맞는지 본다.
 */
import OpenAI from 'openai';
import { streamChat, nonStreamChat } from '../stream-parser';
import { isTransientLLMError, chatTurnWithRoleFallback, type AgentRoleState } from '../../services/agent-task/role-client';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import type { ChatMessage } from '../types';
import { startLlmFixture, sseChunk, type FixtureReply, type LlmFixture } from '../../__tests__/utils/llm-fixture-server';

let fixture: LlmFixture;
let reply: (index: number) => FixtureReply;
const client = () => new OpenAI({ baseURL: fixture.baseURL, apiKey: 'test', maxRetries: 0 });
const request = { model: 'fixture', messages: [{ role: 'user' as const, content: '안녕' }] };
const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };

beforeAll(async () => { fixture = await startLlmFixture((i) => reply(i)); });
afterAll(async () => { await fixture.close(); });
beforeEach(() => { fixture.requests.length = 0; });

describe('streamChat — 정상 스트림', () => {
    it('content 델타를 순서대로 전달하고 usage 를 싣는다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ role: 'assistant', content: '안녕' }),
            sseChunk({ content: '하세요' }, { finish_reason: 'stop' }),
            { ...sseChunk({}), choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } },
        ] });
        const tokens: string[] = [];
        const r = await streamChat(client(), request, (t) => { if (t) tokens.push(t); }, NO_THINK);
        expect(r.content).toBe('안녕하세요');
        expect(tokens.join('')).toBe('안녕하세요');
        expect(r.metrics).toMatchObject({ prompt_tokens: 7, completion_tokens: 3, finish_reason: 'stop' });
        expect(fixture.requests[0]).toMatchObject({ stream: true, model: 'fixture' });
    });

    it('usage 의 캐시 적중 토큰을 싣는다 — 서버가 주지 않으면 필드가 없다(0 으로 꾸미지 않는다)', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
            { ...sseChunk({}), choices: [], usage: { prompt_tokens: 70, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 64 } } },
        ] });
        const hit = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(hit.metrics?.cached_prompt_tokens).toBe(64);

        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '답' }, { finish_reason: 'stop' }),
            { ...sseChunk({}), choices: [], usage: { prompt_tokens: 70, completion_tokens: 3 } },
        ] });
        const none = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(none.metrics).not.toHaveProperty('cached_prompt_tokens');
    });

    it('비스트림 응답도 캐시 적중 토큰을 싣는다 — Anthropic 형식 포함', async () => {
        const body = (usage: Record<string, unknown>) => ({ kind: 'json' as const, body: { choices: [{ message: { content: '답' }, finish_reason: 'stop' }], usage } });
        reply = () => body({ prompt_tokens: 70, completion_tokens: 3, cache_read_input_tokens: 50, cache_creation_input_tokens: 20 });
        expect((await nonStreamChat(client(), request)).metrics?.cached_prompt_tokens).toBe(50);
        reply = () => body({ prompt_tokens: 70, completion_tokens: 3 });
        expect((await nonStreamChat(client(), request)).metrics).not.toHaveProperty('cached_prompt_tokens');
    });

    it('청크 경계에 걸친 </think> 를 본문으로 흘리지 않고 thinking/content 로 나눈다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ content: '계획을 세운다</th' }),
            sseChunk({ content: 'ink>답변입니다' }, { finish_reason: 'stop' }),
        ] });
        const content: string[] = [];
        const thinking: string[] = [];
        const r = await streamChat(client(), request, (t, th) => { if (t) content.push(t); if (th) thinking.push(th); });
        expect(r.content).toBe('답변입니다');
        expect(r.thinking).toBe('계획을 세운다');
        expect(content.join('')).toBe('답변입니다');
        expect(thinking.join('')).not.toContain('</th');
    });

    it('여러 청크로 쪼개진 tool_call 인자를 이어 붙여 파싱한다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'bash', arguments: '{"comm' } }] }),
            sseChunk({ tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] }, { finish_reason: 'tool_calls' }),
        ] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r.tool_calls).toEqual([{ type: 'function', id: 'call_a', function: { name: 'bash', arguments: { command: 'ls' } } }]);
    });
});

describe('도구 호출 인자 JSON 이 깨진 응답', () => {
    it('스트림: 닫히지 않은 인자는 {} 로 두되 깨졌다는 표식을 남긴다', async () => {
        reply = () => ({ kind: 'stream', chunks: [
            sseChunk({ tool_calls: [{ index: 0, id: 'call_a', function: { name: 'file_ops', arguments: '{"op":"write","content":"절반' } }] }, { finish_reason: 'length' }),
        ] });
        const r = await streamChat(client(), request, () => undefined, NO_THINK);
        expect(r.tool_calls).toEqual([{ type: 'function', id: 'call_a', argumentsInvalid: true, function: { name: 'file_ops', arguments: {} } }]);
    });

    it('비스트림: 깨진 인자에 표식을 남기고, 정상 인자와 빈 인자에는 남기지 않는다', async () => {
        const call = (id: string, args: string) => ({ id, type: 'function', function: { name: 'bash', arguments: args } });
        reply = () => ({ kind: 'json', body: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [
            call('a', '{"command":"ls"'), call('b', '{"command":"ls"}'), call('c', ''),
        ] } }] } });
        const r = await nonStreamChat(client(), request);
        expect(r.tool_calls?.map((tc) => [tc.id, tc.argumentsInvalid, tc.function.arguments])).toEqual([
            ['a', true, {}], ['b', undefined, { command: 'ls' }], ['c', undefined, {}],
        ]);
    });
});

describe('streamChat — 장애', () => {
    it('부분 출력 뒤 연결이 끊기면 실패하고, 그 오류는 재시도 대상(일시적)으로 분류된다', async () => {
        reply = () => ({ kind: 'stream', dropAfter: 1, chunks: [sseChunk({ content: '절반만' }), sseChunk({ content: ' 도착' })] });
        const tokens: string[] = [];
        const err = await streamChat(client(), request, (t) => { if (t) tokens.push(t); }, NO_THINK).then(() => null, (e: unknown) => e);
        expect(err).toBeTruthy();
        expect(tokens.join('')).toBe('절반만'); // 끊기기 전 출력은 이미 호출자에게 전달됐다
        expect(isTransientLLMError(err)).toBe(true);
    });

    it.each([500, 503, 429])('HTTP %i 은 status 를 가진 일시적 오류', async (status) => {
        reply = () => ({ kind: 'error', status });
        const err = await streamChat(client(), request, () => undefined, NO_THINK).then(() => null, (e: unknown) => e);
        expect((err as { status?: number }).status).toBe(status);
        expect(isTransientLLMError(err)).toBe(true);
    });

    it('HTTP 400 은 일시적 오류가 아니다(재시도하지 않는다)', async () => {
        reply = () => ({ kind: 'error', status: 400 });
        const err = await nonStreamChat(client(), request).then(() => null, (e: unknown) => e);
        expect((err as { status?: number }).status).toBe(400);
        expect(isTransientLLMError(err)).toBe(false);
    });
});

describe('chatTurnWithRoleFallback — 실제 SDK 로 재시도', () => {
    const limits = AGENT_TASK_LIMITS as { TURN_RETRY_BACKOFF_MS: number };
    const original = limits.TURN_RETRY_BACKOFF_MS;
    beforeAll(() => { limits.TURN_RETRY_BACKOFF_MS = 1; });
    afterAll(() => { limits.TURN_RETRY_BACKOFF_MS = original; });

    /** LLMClient 자리에 스트림 파서를 직접 붙인 최소 클라이언트 — SDK·파서·재시도 분류는 실제 코드가 돈다. */
    function roleState(): AgentRoleState {
        const llm: Record<string, unknown> = {
            chat: (conversation: ChatMessage[], _o: unknown, onToken: ((t: string) => void) | undefined, adv: { signal?: AbortSignal }) =>
                streamChat(client(), { model: 'fixture', messages: conversation }, (t) => { if (t) onToken?.(t); }, NO_THINK, adv.signal),
        };
        llm.derive = () => llm;
        return { client: llm as unknown as AgentRoleState['client'], external: false, fallbackDone: false };
    }
    const turn = (onRetry: jest.Mock) => chatTurnWithRoleFallback(roleState(), {
        conversation: [{ role: 'user', content: '안녕' }], tools: [], signal: new AbortController().signal, taskId: 't1', userId: 'u1', onRetry,
    });

    it('스트림 도중 끊기면 한 번 재시도해 전체 답을 받는다', async () => {
        reply = (i) => i === 0
            ? { kind: 'stream', dropAfter: 1, chunks: [sseChunk({ content: '절반만' }), sseChunk({ content: ' 도착' })] }
            : { kind: 'stream', chunks: [sseChunk({ content: '전체 답변' }, { finish_reason: 'stop' })] };
        const onRetry = jest.fn();
        const r = await turn(onRetry);
        expect(r.content).toBe('전체 답변');
        expect(onRetry).toHaveBeenCalledTimes(1);
        expect(fixture.requests).toHaveLength(2);
    });

    it('HTTP 503 뒤 정상 응답이면 재시도로 복구한다', async () => {
        reply = (i) => i === 0 ? { kind: 'error', status: 503 } : { kind: 'stream', chunks: [sseChunk({ content: '복구됨' }, { finish_reason: 'stop' })] };
        const onRetry = jest.fn();
        await expect(turn(onRetry)).resolves.toMatchObject({ content: '복구됨' });
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('HTTP 400 은 재시도하지 않고 바로 실패한다', async () => {
        reply = () => ({ kind: 'error', status: 400 });
        const onRetry = jest.fn();
        await expect(turn(onRetry)).rejects.toMatchObject({ status: 400 });
        expect(onRetry).not.toHaveBeenCalled();
        expect(fixture.requests).toHaveLength(1);
    });
});
