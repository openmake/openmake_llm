jest.mock('../../config/agent-task-turn-loop', () => {
    const actual = jest.requireActual('../../config/agent-task-turn-loop');
    return { ...actual, AGENT_TASK_TURN_LOOP: { ...actual.AGENT_TASK_TURN_LOOP, THINKING_DOWNGRADE_AFTER_FAILURES: 2 } };
});
import { thinkOptionFor, noteThinkingFailure, noteThinkingSuccess, type ThinkingRunState } from './thinking-downgrade';

const state = (over: Partial<ThinkingRunState> = {}): ThinkingRunState => ({ thinkingLevel: 'medium', thinkingFailures: 0, thinkingDowngraded: false, ...over });

describe('thinkOptionFor', () => {
    it('off 는 false — 종전 요청과 같다', () => expect(thinkOptionFor(state({ thinkingLevel: 'off' }))).toBe(false));
    it('수준은 그대로 ThinkOption 으로', () => {
        expect(thinkOptionFor(state({ thinkingLevel: 'low' }))).toBe('low');
        expect(thinkOptionFor(state({ thinkingLevel: 'high' }))).toBe('high');
    });
    it('강등되면 수준과 무관하게 false', () => expect(thinkOptionFor(state({ thinkingLevel: 'high', thinkingDowngraded: true }))).toBe(false));
});

describe('noteThinkingFailure / noteThinkingSuccess', () => {
    it('임계(2) 전 실패는 강등하지 않는다', () => {
        const s = state();
        expect(noteThinkingFailure(s)).toBe(false);
        expect(s).toMatchObject({ thinkingFailures: 1, thinkingDowngraded: false });
    });
    it('연속 2회면 그때 한 번만 true', () => {
        const s = state();
        noteThinkingFailure(s);
        expect(noteThinkingFailure(s)).toBe(true);
        expect(s.thinkingDowngraded).toBe(true);
        expect(noteThinkingFailure(s)).toBe(false); // 이미 강등됨 — 다시 알리지 않는다
    });
    it('성공이 끼면 연속 실패 수가 0 으로 돌아간다', () => {
        const s = state();
        noteThinkingFailure(s);
        noteThinkingSuccess(s);
        expect(noteThinkingFailure(s)).toBe(false);
        expect(s.thinkingFailures).toBe(1);
    });
    it('off 작업은 세지 않는다', () => {
        const s = state({ thinkingLevel: 'off' });
        expect(noteThinkingFailure(s)).toBe(false);
        expect(s.thinkingFailures).toBe(0);
    });
});
