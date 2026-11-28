/**
 * 생성 미디어 보관량 일별 계상(F25 잔여, opt-in STORAGE_GENERATED_DAILY_SNAPSHOT_ENABLED).
 * 플래그 OFF 면 질의 0, ON 이면 소유자별 살아 있는 바이트를 GB·일로 하루 1행(멱등 키) 적재한다.
 */
const flag = { on: false };
jest.mock('../../../config/quota-extensions', () => ({ storageGeneratedDailySnapshotEnabled: () => flag.on }));
const query = jest.fn(async (_sql: string) => ({ rows: [] as Array<{ owner_user_id: string; bytes: string }> }));
jest.mock('../../../data/models/unified-database', () => ({ getPool: () => ({ query }) }));
const recordCostAsync = jest.fn(async (_e: unknown, _now?: number) => undefined);
jest.mock('../cost-ledger-service', () => ({ recordCostAsync: (e: unknown, now?: number) => recordCostAsync(e, now) }));

import { snapshotGeneratedStorage, snapshotDay, snapshotIdempotencyKey } from '../storage-snapshot';

const NOW = Date.UTC(2026, 10, 28, 6, 0, 0);

beforeEach(() => { flag.on = false; query.mockReset().mockResolvedValue({ rows: [] }); recordCostAsync.mockReset(); });

test('PURE: UTC 날짜 키와 사용자·날짜 멱등 키', () => {
    expect(snapshotDay(NOW)).toBe('2026-11-28');
    expect(snapshotIdempotencyKey('u1', '2026-11-28')).toBe('storage.generated:u1:2026-11-28');
});

test('플래그 OFF: DB 질의·원장 적재 0', async () => {
    await expect(snapshotGeneratedStorage(NOW)).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
    expect(recordCostAsync).not.toHaveBeenCalled();
});

test('플래그 ON: 살아 있는 행만(삭제·게스트·크기 0 제외) 소유자별 GB·일 1행', async () => {
    flag.on = true;
    query.mockResolvedValue({ rows: [{ owner_user_id: 'u1', bytes: '2500000000' }, { owner_user_id: 'u2', bytes: '0' }] });
    await expect(snapshotGeneratedStorage(NOW)).resolves.toBe(1);
    const sql = String(query.mock.calls[0][0]);
    expect(sql).toMatch(/deleted_at IS NULL/);
    expect(sql).toMatch(/owner_user_id IS NOT NULL/);
    expect(sql).toMatch(/size_bytes > 0/);
    expect(recordCostAsync).toHaveBeenCalledTimes(1);
    expect(recordCostAsync).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'u1', kind: 'storage.generated', unit: 'gb_day', quantity: 2.5,
        idempotencyKey: 'storage.generated:u1:2026-11-28',
    }), NOW);
});

test('플래그 ON: 한 사용자 적재 실패는 다른 사용자를 막지 않는다', async () => {
    flag.on = true;
    query.mockResolvedValue({ rows: [{ owner_user_id: 'a', bytes: '1000' }, { owner_user_id: 'b', bytes: '1000' }] });
    recordCostAsync.mockRejectedValueOnce(new Error('db'));
    await expect(snapshotGeneratedStorage(NOW)).resolves.toBe(1);
    expect(recordCostAsync).toHaveBeenCalledTimes(2);
});
