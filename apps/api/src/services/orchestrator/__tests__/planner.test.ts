/** planRequest — 주입 LLM 으로 계획 파싱·재시도·취소·deadline 고정 (실제 모델 호출 없음) */
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { planRequest, type PlannerLlmCall } from '../planner';

const input = { message: '이미지 그려줘', attachments: [{ id: 'a1', kind: 'image' as const, name: 'x.png' }], recentTurns: [], lang: 'ko' };

it('유효한 JSON 이면 1회에 계획을 돌려준다', async () => {
    const call: PlannerLlmCall = async () => JSON.stringify({ complexity: 'multi', tasks: [{ id: 't1', capability: 'image.generate', input: { instruction: 'a cat' } }] });
    const r = await planRequest(input, { call, model: 'test:m' });
    expect(r.plan?.complexity).toBe('multi'); expect(r.attempts).toBe(1); expect(r.model).toBe('test:m');
});

it('첫 응답이 거부되면 사유를 싣고 1회 재시도한다(attempts=2)', async () => {
    let n = 0;
    const seen: string[] = [];
    const call: PlannerLlmCall = async (messages) => {
        n++;
        seen.push(messages[messages.length - 1].content);
        return n === 1 ? '{"complexity":"multi","tasks":[{"id":"t1","capability":"text.synthesize"}]}' : '{"complexity":"simple","tasks":[{"id":"t1","capability":"text.reason"}]}';
    };
    const r = await planRequest(input, { call, model: 'm' });
    expect(r.attempts).toBe(2); expect(r.plan?.complexity).toBe('simple');
    expect(seen[1]).toMatch(/거부되었습니다.*not plannable/);
});

it('이미 취소된 signal 이면 모델을 호출하지 않는다(cancelled)', async () => {
    const ac = new AbortController(); ac.abort();
    const call = jest.fn(async () => '{}');
    const r = await planRequest({ ...input, signal: ac.signal }, { call, model: 'm' });
    expect(call).not.toHaveBeenCalled(); expect(r.error).toBe('cancelled'); expect(r.attempts).toBe(0);
});

it('호출 도중 취소되면 재시도 없이 cancelled', async () => {
    const ac = new AbortController();
    const call = jest.fn(async (_m, _f, signal: AbortSignal) => { ac.abort(); if (signal.aborted) throw new Error('aborted'); return '{}'; });
    const r = await planRequest({ ...input, signal: ac.signal }, { call, model: 'm' });
    expect(call).toHaveBeenCalledTimes(1); expect(r.error).toBe('cancelled');
});

it('모델이 계속 잘못 답하면 재시도 상한 뒤 plan=null (fail-open 사유 보존)', async () => {
    const call: PlannerLlmCall = async () => 'not json at all';
    const r = await planRequest(input, { call, model: 'm' });
    expect(r.plan).toBeNull(); expect(r.error).toMatch(/JSON 파싱 실패/); expect(r.attempts).toBe(2);
});
