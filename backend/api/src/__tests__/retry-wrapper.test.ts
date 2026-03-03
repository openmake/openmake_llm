/**
 * retry-wrapper.ts 단위 테스트
 * withRetry, withTransaction 검증
 */

import { withRetry, withTransaction } from '../data/retry-wrapper';
import type { TransactionClient } from '../data/retry-wrapper';

// logger mock — hoisting 규칙: 팩토리 내부에서 jest.fn() 직접 생성
jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    }),
}));

// ===== withRetry =====

describe('withRetry', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    test('성공 시 결과 반환 (1회 호출)', async () => {
        const fn = jest.fn().mockResolvedValue('result');
        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10 });
        await jest.runAllTimersAsync();
        const result = await promise;
        expect(result).toBe('result');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('재시도 가능 에러 → 재시도 후 성공', async () => {
        const retryableError = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        const fn = jest.fn()
            .mockRejectedValueOnce(retryableError)
            .mockResolvedValue('ok');

        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
        await jest.runAllTimersAsync();
        const result = await promise;
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('ECONNREFUSED → 재시도', async () => {
        const err = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
        const fn = jest.fn()
            .mockRejectedValueOnce(err)
            .mockResolvedValue('connected');

        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
        await jest.runAllTimersAsync();
        const result = await promise;
        expect(result).toBe('connected');
    });

    test('ECONNRESET → 재시도', async () => {
        const err = Object.assign(new Error('reset'), { code: 'ECONNRESET' });
        const fn = jest.fn()
            .mockRejectedValueOnce(err)
            .mockResolvedValue('ok');

        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
        await jest.runAllTimersAsync();
        const result = await promise;
        expect(result).toBe('ok');
    });

    test('deadlock 에러 코드(40P01) → 재시도', async () => {
        const err = Object.assign(new Error('deadlock'), { code: '40P01' });
        const fn = jest.fn()
            .mockRejectedValueOnce(err)
            .mockResolvedValue('ok');

        const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100 });
        await jest.runAllTimersAsync();
        const result = await promise;
        expect(result).toBe('ok');
    });

    test('재시도 불가 에러 → 즉시 throw', async () => {
        const sqlError = Object.assign(new Error('syntax error'), { code: '42601' });
        const fn = jest.fn().mockRejectedValue(sqlError);

        await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('syntax error');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('일반 Error (code 없음) → 즉시 throw', async () => {
        const fn = jest.fn().mockRejectedValue(new Error('unexpected'));
        await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow('unexpected');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('maxRetries 초과 → 마지막 에러 throw', async () => {
        const err = Object.assign(new Error('persistent timeout'), { code: 'ETIMEDOUT' });
        const fn = jest.fn().mockRejectedValue(err);

        let caughtErr: unknown;
        const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100 })
            .catch(e => { caughtErr = e; });
        await jest.runAllTimersAsync();
        await promise;
        expect((caughtErr as Error).message).toBe('persistent timeout');
        // attempt 0, 1, 2 = 양 3회 (maxRetries=2 → 0,1,2까지 시도)
        expect(fn).toHaveBeenCalledTimes(3);
    });
    test('maxRetries=0 → 딱 1회만 시도 후 throw', async () => {
        const err = Object.assign(new Error('fail'), { code: 'ETIMEDOUT' });
        const fn = jest.fn().mockRejectedValue(err);

        let caughtErr: unknown;
        const promise = withRetry(fn, { maxRetries: 0, baseDelayMs: 10 })
            .catch(e => { caughtErr = e; });
        await jest.runAllTimersAsync();
        await promise;
        expect((caughtErr as Error).message).toBe('fail');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    test('non-object 에러 → 재시도 불가로 즉시 throw', async () => {
        const fn = jest.fn().mockRejectedValue('string error');
        await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toBe('string error');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

// ===== withTransaction =====

describe('withTransaction', () => {
    function makeClient(overrides?: Partial<TransactionClient>): TransactionClient {
        return {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
            release: jest.fn(),
            ...overrides,
        };
    }

    function makePool(client: TransactionClient) {
        return {
            connect: jest.fn().mockResolvedValue(client),
        };
    }

    test('성공 시: BEGIN → fn 실행 → COMMIT → release', async () => {
        const client = makeClient();
        const pool = makePool(client);
        const fn = jest.fn().mockResolvedValue('data');

        const result = await withTransaction(pool, fn);

        expect(result).toBe('data');
        expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(fn).toHaveBeenCalledWith(client);
        expect(client.query).toHaveBeenNthCalledWith(2, 'COMMIT');
        expect(client.release).toHaveBeenCalled();
    });

    test('실패 시: BEGIN → fn throw → ROLLBACK → release → rethrow', async () => {
        const client = makeClient();
        const pool = makePool(client);
        const fn = jest.fn().mockRejectedValue(new Error('tx error'));

        await expect(withTransaction(pool, fn)).rejects.toThrow('tx error');

        expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
        expect(client.query).toHaveBeenNthCalledWith(2, 'ROLLBACK');
        expect(client.release).toHaveBeenCalled();
    });

    test('실패해도 release는 항상 호출', async () => {
        const client = makeClient();
        const pool = makePool(client);
        const fn = jest.fn().mockRejectedValue(new Error('fail'));

        await expect(withTransaction(pool, fn)).rejects.toThrow();
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('성공해도 release는 항상 호출', async () => {
        const client = makeClient();
        const pool = makePool(client);
        const fn = jest.fn().mockResolvedValue(null);

        await withTransaction(pool, fn);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test('fn에서 반환한 값이 그대로 전달됨', async () => {
        const client = makeClient();
        const pool = makePool(client);
        const expected = { id: 42, name: 'Alice' };
        const fn = jest.fn().mockResolvedValue(expected);

        const result = await withTransaction(pool, fn);
        expect(result).toEqual(expected);
    });

    test('fn에게 client 객체가 전달됨', async () => {
        const client = makeClient();
        const pool = makePool(client);
        let receivedClient: TransactionClient | null = null;
        const fn = jest.fn().mockImplementation((c: TransactionClient) => {
            receivedClient = c;
            return Promise.resolve('ok');
        });

        await withTransaction(pool, fn);
        expect(receivedClient).toBe(client);
    });

    test('COMMIT은 fn 성공 후에만 호출', async () => {
        const client = makeClient();
        const pool = makePool(client);
        const fn = jest.fn().mockRejectedValue(new Error('fail'));

        await expect(withTransaction(pool, fn)).rejects.toThrow();

        const queryCalls = (client.query as jest.Mock).mock.calls.map(c => c[0]);
        expect(queryCalls).not.toContain('COMMIT');
        expect(queryCalls).toContain('ROLLBACK');
    });
});
