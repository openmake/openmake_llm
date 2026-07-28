/** SteeringRegistry 유닛테스트 — submit/drain FIFO·cap·clear·격리. */
import { SteeringRegistry } from '../steering';

describe('SteeringRegistry', () => {
    it('submit → drain 은 FIFO 로 모두 반환하고 비운다', () => {
        const r = new SteeringRegistry();
        expect(r.submit('t1', '첫째', 10)).toBe(true);
        expect(r.submit('t1', '둘째', 10)).toBe(true);
        expect(r.count('t1')).toBe(2);
        expect(r.drain('t1')).toEqual(['첫째', '둘째']);
        expect(r.count('t1')).toBe(0);
        expect(r.drain('t1')).toEqual([]); // 재 drain 은 빈 배열
    });

    it('maxPending 초과 submit 은 false (플러딩 방지)', () => {
        const r = new SteeringRegistry();
        expect(r.submit('t1', 'a', 2)).toBe(true);
        expect(r.submit('t1', 'b', 2)).toBe(true);
        expect(r.submit('t1', 'c', 2)).toBe(false); // 상한 도달
        expect(r.count('t1')).toBe(2);
    });

    it('task 간 격리 — 한 task drain 이 다른 task 에 영향 없음', () => {
        const r = new SteeringRegistry();
        r.submit('t1', 'x', 10);
        r.submit('t2', 'y', 10);
        expect(r.drain('t1')).toEqual(['x']);
        expect(r.count('t2')).toBe(1);
    });

    it('clear 는 대기 지시를 비운다', () => {
        const r = new SteeringRegistry();
        r.submit('t1', 'x', 10);
        r.clear('t1');
        expect(r.count('t1')).toBe(0);
        expect(r.drain('t1')).toEqual([]);
    });
});
