const sumUserGrants = jest.fn(async () => 0);
const insertIfAbsent = jest.fn(async () => true);
const findPendingOverage = jest.fn(async () => null as null | { id: string });
const createOverageIfNoPending = jest.fn(async (p: { id: string }) => ({ id: p.id }));
jest.mock('../../../data/repositories/quota-grant-repository', () => ({ QuotaGrantRepository: jest.fn().mockImplementation(() => ({ sumUserGrants, insertIfAbsent, findPendingOverage, createOverageIfNoPending })) }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({}) }));

import { rolloverAmount, grantsFor, clearQuotaGrantCache, ensureOverageRequest, maybeCreateRollover } from '../quota-grants';

describe('rolloverAmount (PURE)', () => {
    test('미사용분 × 비율, cap 적용, 비율 0 이면 0', () => {
        expect(rolloverAmount(1000, 300, 0.5, 0)).toBe(350);
        expect(rolloverAmount(1000, 300, 0.5, 100)).toBe(100);
        expect(rolloverAmount(1000, 1200, 0.5, 0)).toBe(0);
        expect(rolloverAmount(1000, 300, 0, 0)).toBe(0);
        expect(rolloverAmount(0, 0, 1, 0)).toBe(0);
    });
});

describe('grantsFor / 캐시', () => {
    beforeEach(() => { clearQuotaGrantCache(); sumUserGrants.mockReset(); sumUserGrants.mockResolvedValue(500); });
    test('TTL 안에서는 1회만 조회, 사용자별 무효화', async () => {
        expect(await grantsFor('u1', 'weekly', 'b', 1000)).toBe(500);
        expect(await grantsFor('u1', 'weekly', 'b', 2000)).toBe(500);
        expect(sumUserGrants).toHaveBeenCalledTimes(1);
        clearQuotaGrantCache('u1');
        await grantsFor('u1', 'weekly', 'b', 3000);
        expect(sumUserGrants).toHaveBeenCalledTimes(2);
    });
    test('조회 실패는 0', async () => {
        sumUserGrants.mockRejectedValue(new Error('db'));
        expect(await grantsFor('u2', 'hourly', 'b')).toBe(0);
    });
});

describe('ensureOverageRequest / maybeCreateRollover', () => {
    beforeEach(() => { findPendingOverage.mockReset(); createOverageIfNoPending.mockReset(); insertIfAbsent.mockReset(); findPendingOverage.mockResolvedValue(null); createOverageIfNoPending.mockImplementation(async (p: { id: string }) => ({ id: p.id })); insertIfAbsent.mockResolvedValue(true); });
    test('pending 이 있으면 그 id 를 돌려주고 새로 만들지 않는다', async () => {
        findPendingOverage.mockResolvedValue({ id: 'existing' });
        expect(await ensureOverageRequest('u1', 'weekly', 'b', 100, null, true)).toBe('existing');
        expect(createOverageIfNoPending).not.toHaveBeenCalled();
    });
    test('없으면 생성', async () => {
        const id = await ensureOverageRequest('u1', 'weekly', 'b', 100, 'why', false);
        expect(typeof id).toBe('string');
        expect(createOverageIfNoPending).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', requestedAmount: 100, autoCreated: false }));
    });
    test('이월 비율 0(기본) 이면 삽입하지 않는다', async () => {
        expect(await maybeCreateRollover('u1', 'weekly', 'b', 1000, 0)).toBe(false);
        expect(insertIfAbsent).not.toHaveBeenCalled();
    });
});
