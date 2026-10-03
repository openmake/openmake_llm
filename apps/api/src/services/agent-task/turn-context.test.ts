/**
 * turn-context — 턴 호출 앞의 컨텍스트 준비(접기 · 창 초과 사전 판정과 인계 요약).
 */
jest.mock('../../config/model-pool', () => {
    const actual = jest.requireActual('../../config/model-pool');
    return {
        ...actual,
        MODEL_POOL_CONFIG: { ...actual.MODEL_POOL_CONFIG, enabled: true, defaultModel: 'pool-model', routingMaxTokensDefault: 100 },
        resolveEffectiveContext: () => 20_000,
    };
});
jest.mock('./turn-call', () => ({ callAgentTurnWithBudget: jest.fn() }));

import { callAgentTurnWithContext } from './turn-context';
import { callAgentTurnWithBudget } from './turn-call';
import { isHandoffSummary } from './context-handoff';
import { isFoldedToolResult } from './context-fold';
import type { ChatMessage } from '../../llm/types';

const call = callAgentTurnWithBudget as jest.Mock;

function conv(turns: number, resultChars: number): ChatMessage[] {
    const c: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: '목표: 보고서를 만든다' }];
    for (let t = 0; t < turns; t++) {
        c.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'bash', arguments: { command: `step ${t}` } } }] });
        c.push({ role: 'tool', content: `[stdout]\n${'가'.repeat(resultChars)}\n[exit=0 1ms]`, tool_name: 'bash', tool_call_id: `c${t}` });
    }
    return c;
}

const base = (conversation: ChatMessage[], model = 'pool-model') => ({
    roleState: { client: { model } } as never, conversation, tools: [], signal: new AbortController().signal,
    taskId: 't', userId: 'u', totalTimeoutMs: 10_000, elapsedActiveMs: 0, finalTurn: false, turn: 3,
});

beforeEach(() => {
    call.mockReset();
    call.mockResolvedValue({ result: { role: 'assistant', content: 'ok' }, callSignal: new AbortController().signal });
});

describe('callAgentTurnWithContext', () => {
    it('오래된 도구 결과를 접은 뒤 호출한다(서비스 루프에서 옮겨 온 동작)', async () => {
        const c = conv(6, 2000);
        await callAgentTurnWithContext(base(c));
        expect(isFoldedToolResult(c.filter((m) => m.role === 'tool')[0].content)).toBe(true);
        expect(call).toHaveBeenCalledTimes(1);
        expect(call.mock.calls[0][0].conversation).toBe(c);
    });

    it('창을 넘으면 호출 전에 오래된 메시지를 인계 요약으로 바꾼다', async () => {
        // 최근 4턴은 접히지 않는다 — 턴당 약 6,000토큰(한글 6,000자)이라 4턴이면 창(20,000)을 넘는다.
        const c = conv(8, 6000);
        await callAgentTurnWithContext(base(c));
        expect(c[0].content).toBe('sys');
        expect(c[1].content).toContain('목표');
        expect(isHandoffSummary(c[2].content)).toBe(true);
        expect(c[2].content).toContain('step 0');
        expect(c[c.length - 1].tool_call_id).toBe('c7');
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('창 안이면 메시지를 버리지 않는다', async () => {
        const c = conv(6, 2000);
        const n = c.length;
        await callAgentTurnWithContext(base(c));
        expect(c.length).toBe(n);
        expect(c.some((m) => isHandoffSummary(m.content))).toBe(false);
    });

    it('풀 기본 모델이 아니면(창 크기를 모른다) 사전 판정을 하지 않는다', async () => {
        const c = conv(8, 6000);
        const n = c.length;
        await callAgentTurnWithContext(base(c, 'external-model'));
        expect(c.length).toBe(n);
    });

    it('도구 호출 인자와 도구 스키마까지 세어 판정한다', async () => {
        // 본문만 세면 창 안(약 2,000토큰)이지만 호출 인자(파일 쓰기 내용 5,000자 × 4턴)를 세면 넘는다.
        const c: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: '목표' }];
        for (let t = 0; t < 8; t++) {
            c.push({ role: 'assistant', content: '', tool_calls: [{ id: `c${t}`, type: 'function', function: { name: 'file_ops', arguments: { op: 'write', path: `f${t}.md`, content: '가'.repeat(5000) } } }] });
            c.push({ role: 'tool', content: `기록됨: f${t}.md`, tool_name: 'file_ops', tool_call_id: `c${t}` });
        }
        await callAgentTurnWithContext(base(c));
        expect(c.some((m) => isHandoffSummary(m.content))).toBe(true);
    });

    it('직전 호출의 실제 사용량이 추정보다 크면 다음 판정을 그 비율로 올린다', async () => {
        const c = conv(4, 2500); // 추정 약 10,000토큰 — 창(20,000) 안
        call.mockResolvedValue({ result: { role: 'assistant', content: 'ok', metrics: { prompt_tokens: 30_000 } }, callSignal: new AbortController().signal });
        await callAgentTurnWithContext(base(c));
        expect(c.some((m) => isHandoffSummary(m.content))).toBe(false);
        // 같은 대화인데 실제는 3배였다 — 다음 턴에는 넘는 것으로 판정해 줄인다.
        await callAgentTurnWithContext(base(c));
        expect(c.some((m) => isHandoffSummary(m.content))).toBe(true);
    });
});
