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

import { callAgentTurnWithContext, isContextOverflowError } from './turn-context';
import { callAgentTurnWithBudget } from './turn-call';
import { isHandoffSummary } from './context-handoff';
import { isFoldedToolResult } from './context-fold';
import { CONTEXT_FOLD_BATCH } from '../../config/agent-task-context';
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

describe('접기 묶음과 창 초과 판정', () => {
    const original = CONTEXT_FOLD_BATCH.MIN_SAVED_CHARS;
    const setBatch = (n: number): void => { (CONTEXT_FOLD_BATCH as { MIN_SAVED_CHARS: number }).MIN_SAVED_CHARS = n; };
    afterEach(() => setBatch(original));
    const folded = (c: ChatMessage[]): number => c.filter((m) => m.role === 'tool' && isFoldedToolResult(m.content)).length;

    it('창 안이면 임계에 못 미치는 접기는 미룬다 — 과거 메시지가 그대로다', async () => {
        setBatch(50_000);
        const c = conv(6, 2000); // 접을 수 있는 것은 2건(약 3,400자) — 임계 미만
        const before = JSON.stringify(c);
        await callAgentTurnWithContext(base(c));
        expect(JSON.stringify(c)).toBe(before);
    });

    it('미뤄 둔 접기 때문에 창을 넘게 되면 임계와 상관없이 접는다 — 접으면 들어가는 대화를 인계 요약으로 버리지 않는다', async () => {
        setBatch(50_000);
        // 9턴 × 3,000자 = 약 27,000토큰으로 창(20,000)을 넘는다. 오래된 5건을 접으면 약 14,000토큰이라 들어간다.
        const c = conv(9, 3000);
        const n = c.length;
        await callAgentTurnWithContext(base(c));
        expect(folded(c)).toBe(5);
        expect(c.length).toBe(n);
        expect(c.some((m) => isHandoffSummary(m.content))).toBe(false);
    });

    it('접어도 창을 넘으면 접은 뒤에 인계 요약으로 줄인다', async () => {
        setBatch(50_000);
        const c = conv(8, 6000); // 최근 4턴만으로 창을 넘는다
        await callAgentTurnWithContext(base(c));
        expect(c.some((m) => isHandoffSummary(m.content))).toBe(true);
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('기본 임계는 미뤄 둔 분량이 창의 일부에 그치게 한다 — 가장 작은 창(입력 예산)의 1/4 을 넘지 않는다', () => {
        // 글자 수 기준 임계가 토큰으로는 최대 글자 수와 같다(한글 1자 ≈ 1토큰). 풀 기본 모델의 창이 32K 일 때 입력 예산은 약 2만 8천 토큰이다.
        expect(original).toBeLessThanOrEqual(28_000 / 4);
    });
});

describe('창 초과 오류 뒤 복구', () => {
    const overflow = () => Object.assign(new Error("400 This model's maximum context length is 32768 tokens. However, you requested 40000 tokens"), { status: 400 });
    const ok = () => ({ result: { role: 'assistant', content: 'ok' }, callSignal: new AbortController().signal });

    it('창 초과 4xx 를 알아본다 — 다른 4xx·5xx 는 아니다', () => {
        expect(isContextOverflowError(overflow())).toBe(true);
        expect(isContextOverflowError(Object.assign(new Error('litellm.ContextWindowExceededError: too long'), { status: 400 }))).toBe(true);
        expect(isContextOverflowError(Object.assign(new Error('400 `tools` must not be an empty array'), { status: 400 }))).toBe(false);
        expect(isContextOverflowError(Object.assign(new Error('maximum context length'), { status: 500 }))).toBe(false);
        expect(isContextOverflowError(Object.assign(new Error('메시지가 모델 컨텍스트 한계를 초과했습니다'), { name: 'ContextOverflowError' }))).toBe(true);
        expect(isContextOverflowError(new Error('boom'))).toBe(false);
    });

    it('창 초과면 대화를 줄여 같은 턴을 한 번 다시 호출한다', async () => {
        // 외부 모델이라 사전 판정이 없다 — 서버 오류로만 알 수 있다.
        const c = conv(8, 3000);
        const before = JSON.stringify(c).length;
        call.mockRejectedValueOnce(overflow()).mockResolvedValueOnce(ok());
        const out = await callAgentTurnWithContext(base(c, 'external-model'));
        expect(out.result.content).toBe('ok');
        expect(call).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(c).length).toBeLessThan(before * 0.7);
        expect(c[1].content).toContain('목표');
        expect(c[c.length - 1].tool_call_id).toBe('c7');
    });

    it('다시 호출해도 창 초과면 그 오류로 끝낸다(1회만)', async () => {
        const c = conv(8, 3000);
        call.mockRejectedValue(overflow());
        await expect(callAgentTurnWithContext(base(c, 'external-model'))).rejects.toThrow('maximum context length');
        expect(call).toHaveBeenCalledTimes(2);
    });

    it('더 줄일 것이 없으면 다시 호출하지 않는다', async () => {
        const c: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: '목표' }];
        call.mockRejectedValue(overflow());
        await expect(callAgentTurnWithContext(base(c, 'external-model'))).rejects.toThrow('maximum context length');
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('창 초과가 아닌 오류는 그대로 던진다', async () => {
        call.mockRejectedValue(Object.assign(new Error('400 bad tools'), { status: 400 }));
        await expect(callAgentTurnWithContext(base(conv(8, 3000), 'external-model'))).rejects.toThrow('bad tools');
        expect(call).toHaveBeenCalledTimes(1);
    });

    it('취소된 작업은 다시 호출하지 않는다', async () => {
        const ac = new AbortController();
        call.mockImplementation(async () => { ac.abort(); throw overflow(); });
        await expect(callAgentTurnWithContext({ ...base(conv(8, 3000), 'external-model'), signal: ac.signal })).rejects.toThrow();
        expect(call).toHaveBeenCalledTimes(1);
    });
});
