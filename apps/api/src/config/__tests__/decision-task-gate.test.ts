/** 작업 게이트 설정 해석 — 잘못된 값이 조용히 켜지지 않게 고정 */
import { parseTaskGateMode, parseTaskGateThreshold, TASK_GATE } from '../decision';

describe('parseTaskGateMode', () => {
    it('shadow·on 만 그대로 받는다', () => {
        expect(parseTaskGateMode('shadow')).toBe('shadow');
        expect(parseTaskGateMode('on')).toBe('on');
    });

    it('없거나 모르는 값(대문자 포함)은 off', () => {
        expect(parseTaskGateMode(undefined)).toBe('off');
        expect(parseTaskGateMode('')).toBe('off');
        expect(parseTaskGateMode('ON')).toBe('off');
        expect(parseTaskGateMode('true')).toBe('off');
    });
});

describe('parseTaskGateThreshold', () => {
    it('0~1 사이 숫자는 그대로', () => {
        expect(parseTaskGateThreshold('0.7')).toBe(0.7);
        expect(parseTaskGateThreshold('0')).toBe(0);
        expect(parseTaskGateThreshold('1')).toBe(1);
    });

    it('없거나 숫자가 아니거나 범위를 벗어나면 기본값', () => {
        expect(parseTaskGateThreshold(undefined)).toBe(0.9);
        expect(parseTaskGateThreshold('')).toBe(0.9);
        expect(parseTaskGateThreshold('abc')).toBe(0.9);
        expect(parseTaskGateThreshold('1.5')).toBe(0.9);
        expect(parseTaskGateThreshold('-0.1')).toBe(0.9);
    });
});

describe('TASK_GATE 기본값', () => {
    it('환경 변수가 없으면 꺼져 있다', () => {
        expect(TASK_GATE.MODE).toBe('off');
        expect(TASK_GATE.THRESHOLD).toBe(0.9);
        expect(TASK_GATE.QUESTION).toMatch(/multi-step/);
    });
});
