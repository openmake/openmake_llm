/**
 * elicitation → HITL 브리지(F13.10) — 답변 해석, 결정 매핑, in-flight 작업 문맥, 입력 대기 중 마감 연장.
 */
import {
    parseElicitationAnswer, resolveElicitation, runWithElicitationContext, inputAwareTimer,
    ElicitationCallTracker, type ElicitationContext, type ElicitationAskResult,
} from '../elicitation-bridge';

const schema1 = { properties: { name: { type: 'string' } }, required: ['name'] };
const schemaN = {
    properties: {
        age: { type: 'integer' }, ok: { type: 'boolean' }, color: { type: 'string', enum: ['red', 'blue'] },
        tags: { type: 'array', items: { enum: ['a', 'b'] } },
    },
    required: ['age'],
};

function ctxWith(result: ElicitationAskResult | Error, taskId = 't1') {
    const ask = jest.fn(async () => { if (result instanceof Error) throw result; return result; });
    return { ctx: { taskId, ask } as ElicitationContext, ask };
}

describe('parseElicitationAnswer', () => {
    it('필드가 하나면 원문을 그 값으로', () => {
        expect(parseElicitationAnswer('홍길동', schema1)).toEqual({ name: '홍길동' });
    });
    it('필드가 하나여도 그 키를 가진 JSON 이면 JSON 으로', () => {
        expect(parseElicitationAnswer('{"name":"kim"}', schema1)).toEqual({ name: 'kim' });
    });
    it('여러 필드는 JSON — 타입 변환·스키마 밖 키 제거', () => {
        expect(parseElicitationAnswer('{"age":"42","ok":"네","color":"red","tags":"a, b","x":1}', schemaN))
            .toEqual({ age: 42, ok: true, color: 'red', tags: ['a', 'b'] });
    });
    it('여러 필드인데 JSON 이 아니면 null', () => {
        expect(parseElicitationAnswer('42', schemaN)).toBeNull();
    });
    it('타입·enum 위반과 필수 누락은 null', () => {
        expect(parseElicitationAnswer('{"age":4.5}', schemaN)).toBeNull();
        expect(parseElicitationAnswer('{"age":1,"color":"green"}', schemaN)).toBeNull();
        expect(parseElicitationAnswer('{"ok":true}', schemaN)).toBeNull();
        expect(parseElicitationAnswer('', schema1)).toBeNull();
    });
    it('필드가 없거나 필수가 없으면 빈 답도 accept', () => {
        expect(parseElicitationAnswer(undefined, {})).toEqual({});
        expect(parseElicitationAnswer('', { properties: { memo: { type: 'string' } } })).toEqual({});
    });
});

describe('resolveElicitation', () => {
    it('작업 문맥이 없으면(채팅 경로) 묻지 않고 decline', async () => {
        await expect(resolveElicitation(undefined, 's', { message: 'm' })).resolves.toEqual({ action: 'decline' });
    });
    it('url 모드는 decline', async () => {
        const { ctx, ask } = ctxWith({ decision: 'approved', text: 'x' });
        await expect(resolveElicitation(ctx, 's', { mode: 'url', message: 'm' })).resolves.toEqual({ action: 'decline' });
        expect(ask).not.toHaveBeenCalled();
    });
    it('승인함 질문 인자에 서버·메시지·스키마를 싣고, 답변을 accept 로', async () => {
        const { ctx, ask } = ctxWith({ decision: 'approved', text: 'kim' });
        await expect(resolveElicitation(ctx, 'od', { message: '이름?', requestedSchema: schema1 }))
            .resolves.toEqual({ action: 'accept', content: { name: 'kim' } });
        expect(ask).toHaveBeenCalledWith({ server: 'od', question: '이름?', requestedSchema: schema1 });
    });
    it('명시 거절은 decline, 만료·중단·대기 실패는 cancel, 해석 실패는 decline', async () => {
        await expect(resolveElicitation(ctxWith({ decision: 'rejected', reason: 'user' }).ctx, 's', { message: 'm' })).resolves.toEqual({ action: 'decline' });
        await expect(resolveElicitation(ctxWith({ decision: 'rejected', reason: 'timeout' }).ctx, 's', { message: 'm' })).resolves.toEqual({ action: 'cancel' });
        await expect(resolveElicitation(ctxWith(new Error('db')).ctx, 's', { message: 'm' })).resolves.toEqual({ action: 'cancel' });
        await expect(resolveElicitation(ctxWith({ decision: 'approved', text: 'x' }).ctx, 's', { message: 'm', requestedSchema: schemaN })).resolves.toEqual({ action: 'decline' });
    });
});

describe('ElicitationCallTracker', () => {
    afterEach(() => jest.useRealTimers());

    it('호출 시점 문맥으로 묻고, 호출이 끝나면 문맥이 사라진다', async () => {
        const tracker = new ElicitationCallTracker('od');
        const { ctx, ask } = ctxWith({ decision: 'approved', text: 'kim' });
        let during: unknown;
        await runWithElicitationContext(ctx, () => tracker.call(async () => {
            during = await tracker.handle({ message: '이름?', requestedSchema: schema1 });
        }));
        expect(during).toEqual({ action: 'accept', content: { name: 'kim' } });
        expect(ask).toHaveBeenCalledTimes(1);
        await expect(tracker.handle({ message: '또?' })).resolves.toEqual({ action: 'decline' });
    });

    it('문맥 없는 호출(채팅)만 진행 중이면 decline', async () => {
        const tracker = new ElicitationCallTracker('od');
        let during: unknown;
        await tracker.call(async () => { during = await tracker.handle({ message: 'm' }); });
        expect(during).toEqual({ action: 'decline' });
    });

    it('서로 다른 작업의 호출이 겹치면 대상을 정할 수 없어 decline', async () => {
        const tracker = new ElicitationCallTracker('od');
        const a = ctxWith({ decision: 'approved', text: 'a' }, 'tA');
        const b = ctxWith({ decision: 'approved', text: 'b' }, 'tB');
        let release!: () => void;
        const gate = new Promise<void>((r) => { release = r; });
        const pA = runWithElicitationContext(a.ctx, () => tracker.call(() => gate));
        let during: unknown;
        await runWithElicitationContext(b.ctx, () => tracker.call(async () => { during = await tracker.handle({ message: 'm' }); }));
        release();
        await pA;
        expect(during).toEqual({ action: 'decline' });
        expect(a.ask).not.toHaveBeenCalled();
        expect(b.ask).not.toHaveBeenCalled();
    });

    it('SDK 호출엔 signal 과 절대 상한 timeout 을 넘기고, 입력 대기가 아니면 마감에 abort 한다', async () => {
        jest.useFakeTimers();
        const tracker = new ElicitationCallTracker('od');
        let signal: AbortSignal | undefined;
        let timeout: number | undefined;
        const p = tracker.call((o) => {
            signal = o.signal; timeout = o.timeout;
            return new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(o.signal.reason)));
        });
        expect(timeout).toBeGreaterThan(60_000);
        jest.advanceTimersByTime(60_000);
        await expect(p).rejects.toThrow(/timed out/);
        expect(signal?.aborted).toBe(true);
    });
});

describe('inputAwareTimer', () => {
    afterEach(() => jest.useRealTimers());

    it('입력 대기 중엔 다시 걸고, 대기가 끝난 뒤 새 창에서 만료된다', () => {
        jest.useFakeTimers();
        let awaiting = true;
        const onTimeout = jest.fn();
        inputAwareTimer(1000, () => awaiting, onTimeout);
        jest.advanceTimersByTime(3000);
        expect(onTimeout).not.toHaveBeenCalled();
        awaiting = false;
        jest.advanceTimersByTime(1000);
        expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('cancel 하면 만료되지 않는다', () => {
        jest.useFakeTimers();
        const onTimeout = jest.fn();
        inputAwareTimer(1000, () => false, onTimeout).cancel();
        jest.advanceTimersByTime(5000);
        expect(onTimeout).not.toHaveBeenCalled();
    });
});
