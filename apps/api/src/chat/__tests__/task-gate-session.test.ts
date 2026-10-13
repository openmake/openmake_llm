/** 작업 게이트 세션 — 채팅 답과 나란히 도는 판정의 수거·기록·실패 격리를 고정한다 (실제 모델·DB 없음) */
import { startTaskGateSession, type TaskGateSessionInput } from '../task-gate-session';
import type { TaskGateRecord } from '../../services/decision/task-gate';
import type { ChatTaskGateLogEntry } from '../../data/repositories/chat-task-gate-log-repository';

const input: TaskGateSessionInput = {
    message: '보고서 파일 만들어서 저장해줘', attachmentKinds: [], fastPathMatched: false,
    userId: 'u1', channel: 'web', modeActive: false,
};
const jev = (pTrue: number): TaskGateRecord => ({ source: 'jev', model: 'jev-decision', pTrue, ms: 240 });
/** 대기 중인 마이크로태스크·타이머를 비운다 */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function harness() {
    const saved: ChatTaskGateLogEntry[] = [];
    const save = jest.fn(async (e: ChatTaskGateLogEntry) => { saved.push(e); });
    return { saved, save };
}

describe('startTaskGateSession — 판정하지 않는 경우', () => {
    it('모드 off, 비로그인, 채팅 모드가 켜진 요청은 판정도 기록도 없다', async () => {
        const { save } = harness();
        const run = jest.fn(async () => jev(0.99));
        for (const [mode, over] of [['off', {}], ['on', { userId: undefined }], ['on', { modeActive: true }]] as const) {
            const s = startTaskGateSession({ ...input, ...over }, { mode, threshold: 0.9, run, save });
            expect(s.finish({ sessionId: 's1', messageId: 1 })).toBeUndefined();
        }
        await flush();
        expect(run).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
    });

    it('판정 모듈이 건너뛰면(undefined — 판정 모델 없음) 기록하지 않는다', async () => {
        const { save } = harness();
        const s = startTaskGateSession(input, { mode: 'on', threshold: 0.9, run: async () => undefined, save });
        await flush();
        expect(s.finish({ sessionId: 's1', messageId: 1 })).toBeUndefined();
        await flush();
        expect(save).not.toHaveBeenCalled();
    });
});

describe('startTaskGateSession — 수거와 기록', () => {
    it('on 이고 기준 이상이면 제안을 돌려주고 suggested=true 로 기록한다', async () => {
        const { saved, save } = harness();
        const s = startTaskGateSession(input, { mode: 'on', threshold: 0.9, run: async () => jev(0.95), save });
        await flush();
        expect(s.finish({ sessionId: 's1', messageId: 42 })).toEqual({ pTrue: 0.95 });
        await flush();
        expect(saved).toEqual([{
            userId: 'u1', sessionId: 's1', messageId: 42, channel: 'web', mode: 'on', source: 'jev',
            pTrue: 0.95, gateError: null, gateMs: 240, gateModel: 'jev-decision', suggested: true, queryChars: input.message.length,
        }]);
    });

    it('shadow 에서는 확률이 높아도 제안하지 않고 기록만 한다', async () => {
        const { saved, save } = harness();
        const s = startTaskGateSession(input, { mode: 'shadow', threshold: 0.9, run: async () => jev(0.99), save });
        await flush();
        expect(s.finish({ sessionId: 's1', messageId: 42 })).toBeUndefined();
        await flush();
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ mode: 'shadow', pTrue: 0.99, suggested: false });
    });

    it('판정이 채팅 답보다 늦으면 제안은 없고, 판정이 끝난 뒤 suggested=false 로 기록한다', async () => {
        const { saved, save } = harness();
        let release: (r: TaskGateRecord) => void = () => undefined;
        const run = () => new Promise<TaskGateRecord>((resolve) => { release = resolve; });
        const s = startTaskGateSession(input, { mode: 'on', threshold: 0.9, run, save });
        expect(s.finish({ sessionId: 's1', messageId: 42 })).toBeUndefined();
        await flush();
        expect(saved).toHaveLength(0);
        release(jev(0.99));
        await flush();
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ pTrue: 0.99, suggested: false });
    });

    it('판정 실패는 확률 없이 사유와 함께 기록한다', async () => {
        const { saved, save } = harness();
        const s = startTaskGateSession(input, { mode: 'on', threshold: 0.9, run: async () => ({ source: 'jev', model: 'jev-decision', ms: 3000, error: 'timeout' }), save });
        await flush();
        expect(s.finish({ sessionId: 's1', messageId: 42 })).toBeUndefined();
        await flush();
        expect(saved[0]).toMatchObject({ pTrue: null, gateError: 'timeout', gateMs: 3000, suggested: false });
    });

    it('답 메시지가 저장되지 않은 턴은 message_id 를 null 로 기록한다', async () => {
        const { saved, save } = harness();
        const s = startTaskGateSession({ ...input, channel: 'api' }, { mode: 'shadow', threshold: 0.9, run: async () => jev(0.2), save });
        await flush();
        s.finish({ sessionId: 's1' });
        await flush();
        expect(saved[0]).toMatchObject({ messageId: null, channel: 'api' });
    });

    it('메시지 id 는 문자열로 와도 정수로 기록하고, 정수가 아니면 null 로 둔다', async () => {
        const { saved, save } = harness();
        for (const messageId of ['42', 'not-a-number']) {
            const s = startTaskGateSession(input, { mode: 'shadow', threshold: 0.9, run: async () => jev(0.2), save });
            await flush();
            s.finish({ sessionId: 's1', messageId });
            await flush();
        }
        expect(saved.map((e) => e.messageId)).toEqual([42, null]);
    });

    it('규칙 판정은 모델 없이 source=rule 로 기록한다', async () => {
        const { saved, save } = harness();
        const s = startTaskGateSession(input, { mode: 'shadow', threshold: 0.9, run: async () => ({ source: 'rule', pTrue: 0, ms: 0 }), save });
        await flush();
        s.finish({ sessionId: 's1', messageId: 7 });
        await flush();
        expect(saved[0]).toMatchObject({ source: 'rule', pTrue: 0, gateModel: null, gateMs: 0 });
    });
});

describe('startTaskGateSession — 실패 격리', () => {
    it('판정 함수가 예외를 던져도 finish 는 조용히 undefined 를 돌려주고 기록하지 않는다', async () => {
        const { save } = harness();
        const s = startTaskGateSession(input, { mode: 'on', threshold: 0.9, run: async () => { throw new Error('boom'); }, save });
        await flush();
        expect(s.finish({ sessionId: 's1', messageId: 1 })).toBeUndefined();
        await flush();
        expect(save).not.toHaveBeenCalled();
    });

    it('기록 저장이 실패해도 예외가 밖으로 나오지 않는다', async () => {
        const save = jest.fn(async () => { throw new Error('db down'); });
        const s = startTaskGateSession(input, { mode: 'on', threshold: 0.9, run: async () => jev(0.95), save });
        await flush();
        expect(s.finish({ sessionId: 's1', messageId: 1 })).toEqual({ pTrue: 0.95 });
        await flush();
        expect(save).toHaveBeenCalledTimes(1);
    });
});
