/**
 * RequestGuard — 실행 전 요청 검사(만료·중복). 서버가 보낸 요청을 기기가 다시 판정한다 (Companion P1, 2026-10-04).
 */
import { EXPIRY_SKEW_TOLERANCE_MS, SEEN_REQ_MAX } from '../constants';
import { RequestGuard } from '../request-guard';

describe('RequestGuard', () => {
    const NOW = 1_800_000_000_000;

    it('expiresAt 가 없는 요청(구버전 서버)은 통과한다', () => {
        expect(new RequestGuard().check({ reqId: 'a' }, NOW)).toBeNull();
    });

    it('만료 시각이 지난 요청은 거절한다', () => {
        const r = new RequestGuard().check({ reqId: 'a', expiresAt: NOW - EXPIRY_SKEW_TOLERANCE_MS - 1 }, NOW);
        expect(r).toMatchObject({ rejected: 'expired' });
    });

    it('시계 오차 허용 범위 안의 만료는 통과한다 — PC 시계가 서버보다 앞서도 정상 요청을 버리지 않는다', () => {
        expect(new RequestGuard().check({ reqId: 'a', expiresAt: NOW - EXPIRY_SKEW_TOLERANCE_MS + 1000 }, NOW)).toBeNull();
        expect(new RequestGuard().check({ reqId: 'b', expiresAt: NOW + 60_000 }, NOW)).toBeNull();
    });

    it('숫자가 아닌 expiresAt 는 없는 것으로 본다', () => {
        expect(new RequestGuard().check({ reqId: 'a', expiresAt: 'soon' as unknown as number }, NOW)).toBeNull();
        expect(new RequestGuard().check({ reqId: 'b', expiresAt: Number.NaN }, NOW)).toBeNull();
    });

    it('이미 처리한 reqId 는 거절한다', () => {
        const g = new RequestGuard();
        expect(g.check({ reqId: 'same' }, NOW)).toBeNull();
        expect(g.check({ reqId: 'same' }, NOW + 5)).toMatchObject({ rejected: 'duplicate' });
    });

    it('만료로 거절한 reqId 는 기억하지 않는다 — 처리한 적이 없다', () => {
        const g = new RequestGuard();
        expect(g.check({ reqId: 'x', expiresAt: NOW - EXPIRY_SKEW_TOLERANCE_MS - 1 }, NOW)).toMatchObject({ rejected: 'expired' });
        expect(g.check({ reqId: 'x' }, NOW)).toBeNull();
    });

    it('reqId 가 없으면 중복을 판정하지 않는다', () => {
        const g = new RequestGuard();
        expect(g.check({}, NOW)).toBeNull();
        expect(g.check({}, NOW)).toBeNull();
    });

    it('기억하는 reqId 수에 상한이 있다 — 오래된 것부터 잊는다', () => {
        const g = new RequestGuard();
        for (let i = 0; i < SEEN_REQ_MAX + 1; i++) expect(g.check({ reqId: `r${i}` }, NOW)).toBeNull();
        expect(g.check({ reqId: 'r0' }, NOW)).toBeNull();               // 밀려났다
        expect(g.check({ reqId: `r${SEEN_REQ_MAX}` }, NOW)).toMatchObject({ rejected: 'duplicate' });
    });
});
