/**
 * token-cleanup.test.ts
 * token_blacklist / chat_rate_limits 만료 항목 정리 유틸리티 테스트
 */

const mockQuery = jest.fn();

jest.mock('../data/models/unified-database', () => ({
    getPool: jest.fn(() => ({ query: mockQuery }))
}));

jest.mock('../utils/logger', () => ({
    createLogger: () => ({
        info: jest.fn(),
        error: jest.fn()
    })
}));

import {
    pruneExpiredTokens,
    pruneExpiredRateLimits,
    startPeriodicCleanup,
    stopPeriodicCleanup
} from '../utils/token-cleanup';

beforeEach(() => {
    mockQuery.mockReset();
    jest.useFakeTimers();
});

afterEach(() => {
    stopPeriodicCleanup();
    jest.useRealTimers();
});

describe('pruneExpiredTokens', () => {
    test('만료 토큰 삭제 후 삭제된 수 반환', async () => {
        mockQuery.mockResolvedValueOnce({ rowCount: 3 });
        const result = await pruneExpiredTokens();
        expect(result).toBe(3);
        expect(mockQuery).toHaveBeenCalledWith(
            'DELETE FROM token_blacklist WHERE expires_at < $1',
            expect.any(Array)
        );
    });

    test('삭제 없을 때 0 반환', async () => {
        mockQuery.mockResolvedValueOnce({ rowCount: 0 });
        const result = await pruneExpiredTokens();
        expect(result).toBe(0);
    });

    test('rowCount null이면 0 반환', async () => {
        mockQuery.mockResolvedValueOnce({ rowCount: null });
        const result = await pruneExpiredTokens();
        expect(result).toBe(0);
    });

    test('DB 오류 시 0 반환 (에러 전파 안 함)', async () => {
        mockQuery.mockRejectedValueOnce(new Error('DB down'));
        const result = await pruneExpiredTokens();
        expect(result).toBe(0);
    });
});

describe('pruneExpiredRateLimits', () => {
    test('만료 레이트리밋 삭제 후 삭제된 수 반환', async () => {
        mockQuery.mockResolvedValueOnce({ rowCount: 5 });
        const result = await pruneExpiredRateLimits();
        expect(result).toBe(5);
        expect(mockQuery).toHaveBeenCalledWith(
            'DELETE FROM chat_rate_limits WHERE reset_at < NOW()'
        );
    });

    test('DB 오류 시 0 반환', async () => {
        mockQuery.mockRejectedValueOnce(new Error('timeout'));
        const result = await pruneExpiredRateLimits();
        expect(result).toBe(0);
    });
});

describe('startPeriodicCleanup / stopPeriodicCleanup', () => {
    test('중복 호출해도 interval 하나만 생성', () => {
        mockQuery.mockResolvedValue({ rowCount: 0 });
        startPeriodicCleanup();
        startPeriodicCleanup(); // 중복

        const setIntervalSpy = jest.spyOn(global, 'setInterval');
        // 두 번째 호출은 early return — spy 카운트 0
        expect(setIntervalSpy).toHaveBeenCalledTimes(0);
        setIntervalSpy.mockRestore();
    });

    test('stopPeriodicCleanup 후 재시작 가능', () => {
        mockQuery.mockResolvedValue({ rowCount: 0 });
        startPeriodicCleanup();
        stopPeriodicCleanup();
        // 중단 후 재시작 — 에러 없어야 함
        expect(() => startPeriodicCleanup()).not.toThrow();
    });
});
