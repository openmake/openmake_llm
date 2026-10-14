/**
 * stream-parser — 중단(abort)으로 끝난 스트림의 부분 tool call 을 flush 하지 않는다.
 *
 * 회귀(2026-10-14 운영): 클라이언트가 도구 호출 인자를 스트리밍하던 요청을 끊자, 스트림이 끝난 것처럼
 * 빠져나와 잘린 인자 JSON 이 {} 로 강등된 tool call 로 반환되고 상위 루프가 그것을 실제로 실행했다.
 * 수정: signal 이 aborted 인 채로 끝났으면 tool call 버퍼(텍스트 툴콜 복구 포함)를 버리고 aborted: true 를 표시한다.
 */
jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { streamChat } from '../stream-parser';

const NO_THINK = { chat_template_kwargs: { enable_thinking: false } };
const request = { model: 'fake', messages: [{ role: 'user' as const, content: '산출물 만들어줘' }] };

/** delta 들을 흘린 뒤 (controller 가 있으면) 중단하고 스트림을 끝내는 가짜 OpenAI 클라이언트. */
function fakeOpenAI(deltas: Array<Record<string, unknown>>, controller?: AbortController): any {
    async function* gen() {
        for (const delta of deltas) yield { choices: [{ delta, finish_reason: null }] } as unknown;
        controller?.abort();
    }
    return { chat: { completions: { create: jest.fn().mockResolvedValue(gen()) } } };
}

const PARTIAL_TOOL_DELTAS = [
    { content: '만들게요.' },
    { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'create_artifact', arguments: '{"html":"<html><bo' } }] },
];

const PSEUDO_DELTAS = [
    { content: '<tool_call>\n<function=web_search>\n<parameter=query>\n서울 날씨\n</parameter>\n</function>\n</tool_call>' },
];

describe('streamChat — 중단으로 끝난 스트림', () => {
    it('aborted 종료 시 부분 tool call 을 flush 하지 않고 aborted 를 표시한다', async () => {
        const controller = new AbortController();
        const r = await streamChat(fakeOpenAI(PARTIAL_TOOL_DELTAS, controller), request, () => undefined, NO_THINK, controller.signal);
        expect(r.tool_calls).toBeUndefined();
        expect(r.aborted).toBe(true);
        // 기존 반환 형태 유지 — 받은 본문은 그대로 싣는다.
        expect(r.content).toBe('만들게요.');
    });

    it('aborted 종료 시 텍스트로 새어나온 툴콜도 tool call 로 복구하지 않는다', async () => {
        const controller = new AbortController();
        const r = await streamChat(fakeOpenAI(PSEUDO_DELTAS, controller), request, () => undefined, NO_THINK, controller.signal);
        expect(r.tool_calls).toBeUndefined();
        expect(r.aborted).toBe(true);
    });

    it('중단 없이 끝나면 기존대로 tool call 을 돌려주고 aborted 를 싣지 않는다', async () => {
        const controller = new AbortController();
        const r = await streamChat(fakeOpenAI(PARTIAL_TOOL_DELTAS), request, () => undefined, NO_THINK, controller.signal);
        expect(r.tool_calls).toHaveLength(1);
        expect(r).not.toHaveProperty('aborted');

        const p = await streamChat(fakeOpenAI(PSEUDO_DELTAS), request, () => undefined, NO_THINK, controller.signal);
        expect(p.tool_calls?.[0]?.function.name).toBe('web_search');
    });
});
