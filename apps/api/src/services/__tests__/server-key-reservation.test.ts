/**
 * 서버 공용 키 예산 원자 예약(P04) — T24 동시 요청 두 건이 합계로 상한을 넘지 못한다 · T25 usage 없음은 예약 유지(무료 정산 금지).
 */
// 운영 .env 의 STORAGE_BACKEND(redis)를 타지 않도록 메모리 저장소로 고정한다 — 원자성 검증은 incrBy 의미만 필요하다
jest.mock('../../storage', () => {
    const { MemoryStore } = jest.requireActual('../../storage/memory-store');
    let store = new MemoryStore();
    return { getKeyValueStore: () => store, resetKeyValueStoreForTests: () => { store = new MemoryStore(); } };
});
import { getKeyValueStore, resetKeyValueStoreForTests } from '../../storage';
import { reserveServerKeyBudget, settleServerKeyReservation, checkServerKeyBudget } from '../server-key-quota';

beforeEach(() => resetKeyValueStoreForTests());

describe('reserveServerKeyBudget', () => {
    it('T24: 상한 1500 에 1000 짜리 동시 예약 2건 — 하나만 통과, 합계가 상한을 넘지 않는다', async () => {
        const [a, b] = await Promise.all([
            reserveServerKeyBudget('hasa', 1000, 1500, null, 0),
            reserveServerKeyBudget('hasa', 1000, 1500, null, 0),
        ]);
        const ok = [a, b].filter((r) => 'reservation' in r);
        const rejected = [a, b].filter((r) => 'rejected' in r);
        expect(ok).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as { rejected: string }).rejected).toMatch(/상한 초과/);
        // 거절된 쪽은 환불돼 사용량이 1000 에 머문다 — 종전 check-only 는 둘 다 통과시켰다
        const used = await getKeyValueStore().get<number>('srvkeyq:hasa:d:0');
        expect(used).toBe(1000);
        expect(await checkServerKeyBudget('hasa', 1500, null, 0)).toBeNull();
    });

    it('일 상한 0 은 잠금, 월 상한도 검사한다', async () => {
        expect(await reserveServerKeyBudget('p', 10, 0, null, 0)).toMatchObject({ rejected: expect.stringContaining('잠금') });
        expect(await reserveServerKeyBudget('p', 10, 100, 5, 0)).toMatchObject({ rejected: expect.stringContaining('월') });
        expect(await getKeyValueStore().get<number>('srvkeyq:p:d:0')).toBeFalsy();
    });

    it('T25: 정산 — usage 없음(null)은 예약 유지, 실측은 차이만 보정, 전송 전 실패(0)는 전액 환불', async () => {
        const store = getKeyValueStore();
        const r = await reserveServerKeyBudget('p', 1000, 10_000, null, 0);
        if (!('reservation' in r)) throw new Error('예약 실패');
        await settleServerKeyReservation(r.reservation, null);
        expect(await store.get<number>('srvkeyq:p:d:0')).toBe(1000);
        await settleServerKeyReservation(r.reservation, 1300);
        expect(await store.get<number>('srvkeyq:p:d:0')).toBe(1300);
        const r2 = await reserveServerKeyBudget('p', 1000, 10_000, null, 0);
        if (!('reservation' in r2)) throw new Error('예약 실패');
        await settleServerKeyReservation(r2.reservation, 0);
        expect(await store.get<number>('srvkeyq:p:d:0')).toBe(1300);
    });
});
