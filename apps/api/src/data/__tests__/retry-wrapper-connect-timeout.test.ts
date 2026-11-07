/**
 * withRetry — pg-pool 연결 timeout 오류 재시도 회귀 가드.
 *
 * pg-pool 의 연결 timeout 오류는 `code` 없는 일반 Error 라서 code 기반 판정만으로는
 * 재시도 불가로 보고 즉시 던졌다(기동 initSchema 가 곧바로 Fail-Fast).
 *  (a) 연결 timeout 문구 Error 는 재시도 후 성공한다.
 *  (b) 그 밖의 code 없는 Error 는 재시도 없이 즉시 던진다.
 *  (c) ECONNREFUSED 같은 code 기반 판정은 기존대로 재시도한다.
 */

jest.mock('../../utils/logger', () => ({
    createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { withRetry } from '../retry-wrapper';

const FAST = { baseDelayMs: 1, maxDelayMs: 1, operation: 'test' };

function failThenSucceed(err: unknown, failures = 1): jest.Mock {
    let calls = 0;
    return jest.fn(async () => {
        calls++;
        if (calls <= failures) throw err;
        return 'ok';
    });
}

describe('withRetry — pg-pool 연결 timeout', () => {
    it.each([
        'timeout exceeded when trying to connect',
        'Connection terminated due to connection timeout',
    ])('(a) "%s" 는 재시도 후 성공한다', async (message) => {
        const fn = failThenSucceed(new Error(message), 2);
        await expect(withRetry(fn, FAST)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('(a) 재시도를 모두 소진하면 마지막 오류를 던진다(Fail-Fast 유지)', async () => {
        const err = new Error('timeout exceeded when trying to connect');
        const fn = jest.fn(async () => { throw err; });
        await expect(withRetry(fn, { ...FAST, maxRetries: 2 })).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('(b) 일반 Error 는 재시도 없이 즉시 던진다', async () => {
        const err = new Error('syntax error at or near "SELEC"');
        const fn = jest.fn(async () => { throw err; });
        await expect(withRetry(fn, FAST)).rejects.toBe(err);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('(c) ECONNREFUSED 는 기존대로 재시도한다', async () => {
        const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        const fn = failThenSucceed(err, 1);
        await expect(withRetry(fn, FAST)).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
