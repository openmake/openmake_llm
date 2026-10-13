/** 작업 게이트 — 판정 입력 구성, 실행 조건, 제안 조건 고정 (실제 모델 호출 없음) */
import { buildTaskGateState, runTaskGate, shouldSuggestTask } from '../task-gate';
import { DECISION, TASK_GATE } from '../../../config/decision';

const base = { message: '보고서 파일 만들어서 저장해줘', attachmentKinds: [] as string[], fastPathMatched: false };

describe('buildTaskGateState', () => {
    it('사용자 메시지와 첨부 종류를 싣는다', () => {
        expect(buildTaskGateState('배포해줘', ['image'])).toBe('User message: "배포해줘"\nAttachments: image');
    });

    it('본문이 비어도 형식이 깨지지 않는다', () => {
        expect(buildTaskGateState('', ['file'])).toBe('User message: ""\nAttachments: file');
        expect(buildTaskGateState('   \n ', [])).toBe('User message: ""\nAttachments: none');
    });

    it('긴 메시지는 상한에서 자른다', () => {
        const s = buildTaskGateState('가'.repeat(DECISION.STATE_MAX_CHARS + 500), []);
        expect(s.length).toBeLessThan(DECISION.STATE_MAX_CHARS + 60);
    });
});

describe('runTaskGate', () => {
    it('모드가 off 면 호출하지 않는다(undefined)', async () => {
        const decide = jest.fn(async () => ({ pTrue: 1, ms: 1 }));
        const r = await runTaskGate(base, { mode: 'off', modelAvailable: () => true, decide });
        expect(r).toBeUndefined();
        expect(decide).not.toHaveBeenCalled();
    });

    it('판정 모델이 카탈로그에 없으면 호출하지 않는다(undefined) — 규칙 판정도 남기지 않는다', async () => {
        const decide = jest.fn(async () => ({ pTrue: 1, ms: 1 }));
        expect(await runTaskGate(base, { mode: 'shadow', modelAvailable: () => false, decide })).toBeUndefined();
        expect(await runTaskGate({ ...base, fastPathMatched: true }, { mode: 'shadow', modelAvailable: () => false, decide })).toBeUndefined();
        expect(decide).not.toHaveBeenCalled();
    });

    it('명백한 단답(fast-path)은 어댑터를 부르지 않고 규칙으로 확정한다', async () => {
        const decide = jest.fn(async () => ({ pTrue: 1, ms: 1 }));
        const r = await runTaskGate({ ...base, message: '안녕하세요', fastPathMatched: true }, { mode: 'shadow', modelAvailable: () => true, decide });
        expect(r).toEqual({ source: 'rule', pTrue: 0, ms: 0 });
        expect(decide).not.toHaveBeenCalled();
    });

    it('짧은 지시도 길이로 거르지 않고 어댑터에 묻는다', async () => {
        const decide = jest.fn(async () => ({ pTrue: 0.91, ms: 240 }));
        const r = await runTaskGate({ ...base, message: '배포해줘' }, { mode: 'shadow', modelAvailable: () => true, decide });
        expect(decide).toHaveBeenCalledTimes(1);
        expect(decide.mock.calls[0][0]).toEqual({ state: 'User message: "배포해줘"\nAttachments: none', question: TASK_GATE.QUESTION });
        expect(r).toEqual({ source: 'jev', model: DECISION.MODEL, pTrue: 0.91, ms: 240 });
    });

    it('판정 실패는 사유만 싣는다 — 예외를 올리지 않는다', async () => {
        const r = await runTaskGate(base, { mode: 'on', modelAvailable: () => true, decide: async () => ({ pTrue: null, ms: 3000, error: 'timeout' }) });
        expect(r).toEqual({ source: 'jev', model: DECISION.MODEL, ms: 3000, error: 'timeout' });
    });
});

describe('shouldSuggestTask', () => {
    const jev = (pTrue: number) => ({ source: 'jev' as const, pTrue, ms: 1 });

    it('on 이고 기준 이상일 때만 참', () => {
        expect(shouldSuggestTask(jev(0.95), { mode: 'on', threshold: 0.9 })).toBe(true);
        expect(shouldSuggestTask(jev(0.9), { mode: 'on', threshold: 0.9 })).toBe(true);
        expect(shouldSuggestTask(jev(0.89), { mode: 'on', threshold: 0.9 })).toBe(false);
    });

    it('shadow·off 에서는 확률이 높아도 거짓', () => {
        expect(shouldSuggestTask(jev(0.99), { mode: 'shadow', threshold: 0.9 })).toBe(false);
        expect(shouldSuggestTask(jev(0.99), { mode: 'off', threshold: 0.9 })).toBe(false);
    });

    it('판정 없음·판정 실패·규칙 판정은 거짓', () => {
        expect(shouldSuggestTask(undefined, { mode: 'on', threshold: 0 })).toBe(false);
        expect(shouldSuggestTask({ source: 'jev', ms: 3000, error: 'timeout' }, { mode: 'on', threshold: 0 })).toBe(false);
        expect(shouldSuggestTask({ source: 'rule', pTrue: 0, ms: 0 }, { mode: 'on', threshold: 0 })).toBe(false);
    });
});
