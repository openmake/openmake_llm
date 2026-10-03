import { nextTurnProgress } from './turn-progress';

describe('nextTurnProgress — 턴 시작 진행률', () => {
    it('plan 이 있으면 완료 단계 비율(상한 90)을 쓰고 현재값 아래로 내려가지 않는다', () => {
        const steps = [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }, { status: 'pending' }];
        expect(nextTurnProgress(steps, 2)).toBe(23);
        expect(nextTurnProgress(steps, 50)).toBe(50);
        expect(nextTurnProgress([{ status: 'completed' }], 2)).toBe(90);
        expect(nextTurnProgress([{ status: 'pending' }], 0)).toBe(2);
    });

    it('plan 이 없으면 남은 거리의 25%(최소 4)를 채우고 90 을 넘지 않는다', () => {
        expect(nextTurnProgress([], 2)).toBe(24);
        expect(nextTurnProgress([], 88)).toBe(90);
        expect(nextTurnProgress([], 90)).toBe(90);
    });
});
