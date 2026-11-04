/**
 * knowledge-runtime/db — 실제 db.ts 를 로드하고 포트(runtime-ports/db-access)의 getPool 만 제어해
 * 풀 반환·트랜잭션(BEGIN → fn → COMMIT, 실패 시 ROLLBACK·원래 오류 보존, release 1회)을 검증한다.
 */
const mockGetPool = jest.fn();
jest.mock('../../../runtime-ports/db-access', () => ({ getPool: () => mockGetPool() }));

import { inTransaction, kdb } from '../db';

type Step = 'BEGIN' | 'COMMIT' | 'ROLLBACK';

function fakeClient(fail: Partial<Record<Step, Error>> = {}) {
    const calls: string[] = [];
    const client = {
        calls,
        query: jest.fn(async (sql: string) => {
            calls.push(sql);
            const err = fail[sql as Step];
            if (err) throw err;
            return { rows: [], rowCount: 0 };
        }),
        release: jest.fn(),
    };
    return client;
}

function poolWith(client: ReturnType<typeof fakeClient>) {
    const pool = { connect: jest.fn(async () => client) };
    mockGetPool.mockReturnValue(pool);
    return pool;
}

beforeEach(() => mockGetPool.mockReset());

describe('kdb', () => {
    it('포트 getPool() 과 같은 객체를 반환한다', () => {
        const pool = { tag: 'base-pool' };
        mockGetPool.mockReturnValue(pool);
        expect(kdb()).toBe(pool);
        expect(mockGetPool).toHaveBeenCalledTimes(1);
    });
});

describe('inTransaction', () => {
    it('성공: 같은 client 로 BEGIN → fn → COMMIT, 반환값 보존, release 1회', async () => {
        const client = fakeClient();
        const pool = poolWith(client);
        const fn = jest.fn(async (c: unknown) => {
            expect(c).toBe(client);
            client.calls.push('fn');
            return { ok: 42 };
        });

        await expect(inTransaction(fn)).resolves.toEqual({ ok: 42 });
        expect(pool.connect).toHaveBeenCalledTimes(1);
        expect(client.calls).toEqual(['BEGIN', 'fn', 'COMMIT']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('callback 실패: ROLLBACK 시도, 원래 오류 그대로, release 1회', async () => {
        const client = fakeClient();
        poolWith(client);
        const boom = new Error('fn failed');

        await expect(inTransaction(async () => { throw boom; })).rejects.toBe(boom);
        expect(client.calls).toEqual(['BEGIN', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('BEGIN 실패: callback 미실행, ROLLBACK 시도, 원래 오류 그대로, release 1회', async () => {
        const beginErr = new Error('begin failed');
        const client = fakeClient({ BEGIN: beginErr });
        poolWith(client);
        const fn = jest.fn(async () => 'never');

        await expect(inTransaction(fn)).rejects.toBe(beginErr);
        expect(fn).not.toHaveBeenCalled();
        expect(client.calls).toEqual(['BEGIN', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('COMMIT 실패: ROLLBACK 시도, 원래 오류 그대로, release 1회', async () => {
        const commitErr = new Error('commit failed');
        const client = fakeClient({ COMMIT: commitErr });
        poolWith(client);

        await expect(inTransaction(async () => 'value')).rejects.toBe(commitErr);
        expect(client.calls).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('ROLLBACK 자체가 실패해도 원래 오류를 보존한다', async () => {
        const client = fakeClient({ ROLLBACK: new Error('rollback failed') });
        poolWith(client);
        const boom = new Error('fn failed');

        await expect(inTransaction(async () => { throw boom; })).rejects.toBe(boom);
        expect(client.calls).toEqual(['BEGIN', 'ROLLBACK']);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    it('connect 실패: callback 미실행, 오류 전달', async () => {
        const connErr = new Error('connect failed');
        mockGetPool.mockReturnValue({ connect: jest.fn(async () => { throw connErr; }) });
        const fn = jest.fn(async () => 'never');

        await expect(inTransaction(fn)).rejects.toBe(connErr);
        expect(fn).not.toHaveBeenCalled();
    });
});
