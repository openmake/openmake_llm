// 임계값은 .env(AGENT_TASK_FINAL_TURN_MIN_ANSWER)에 좌우되므로 고정해 결정적으로 만든다.
jest.mock('../../config/runtime-limits', () => {
    const actual = jest.requireActual('../../config/runtime-limits');
    return {
        ...actual,
        AGENT_TASK_LIMITS: { ...actual.AGENT_TASK_LIMITS, FINAL_TURN_MIN_ANSWER_CHARS: 200 },
    };
});

import { shouldAdoptFinalTurnAnswer } from './turn-gate';

const base = { finalTurn: true, hasNativeTools: true, hasTextTools: false, answerLength: 500 };

describe('shouldAdoptFinalTurnAnswer — 마무리 턴 본문 채택', () => {
    it('도구 호출이 섞여도 본문이 충분하면 채택한다 (완성 산출물 폐기 방지)', () => {
        expect(shouldAdoptFinalTurnAnswer(base)).toBe(true);
    });

    it('본문이 임계 미만인 의도 선언은 채택하지 않는다', () => {
        // 실측 사례: "Last turn. I need to produce the data.json ... Let me do this" (100자 안팎)
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 100 })).toBe(false);
    });

    it('본문이 비었으면 채택하지 않는다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 0 })).toBe(false);
    });

    it('텍스트(XML) 도구 호출은 본문 자체가 호출문이라 채택하지 않는다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, hasNativeTools: false, hasTextTools: true })).toBe(false);
    });

    it('마무리 턴이 아니면 판정 대상이 아니다 (정상 도구 루프)', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, finalTurn: false })).toBe(false);
    });

    it('도구 호출이 없으면 이 경로를 타지 않는다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, hasNativeTools: false })).toBe(false);
    });

    it('임계 경계값은 채택한다', () => {
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 200 })).toBe(true);
        expect(shouldAdoptFinalTurnAnswer({ ...base, answerLength: 199 })).toBe(false);
    });
});
