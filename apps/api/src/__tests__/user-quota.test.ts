/**
 * Per-User Token Quota 단위 테스트 (KVStore memory backend 기반).
 *
 * 검증:
 *   1. 한도 미만 → 통과
 *   2. record 누적 후 한도 도달 → QuotaExceededError
 *   3. 사용자 격리 (A 소진이 B 에 영향 없음)
 *   4. 비인증(guest/undefined) → enforcement skip
 */
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { checkUserQuota, recordUserUsage } from '../llm/user-quota';
import { resetKeyValueStoreForTests } from '../storage';
import { resetConfig } from '../config/env';
import { QuotaExceededError } from '../errors/quota-exceeded.error';

const ORIGINAL_ENV = { ...process.env };
const NOW = 1_700_000_000_000; // 고정 timestamp (버킷 일관성)

beforeEach(() => {
    process.env.STORAGE_BACKEND = 'memory';
    process.env.LLM_HOURLY_TOKEN_LIMIT = '1000';
    process.env.LLM_WEEKLY_TOKEN_LIMIT = '5000';
    resetConfig();
    resetKeyValueStoreForTests();
});

afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetConfig();
    resetKeyValueStoreForTests();
});

describe('user-quota', () => {
    it('한도 미만 → 통과', async () => {
        await recordUserUsage('user-A', 500, NOW);
        await expect(checkUserQuota('user-A', NOW)).resolves.toBeUndefined();
    });

    it('hourly 한도 도달 → QuotaExceededError', async () => {
        await recordUserUsage('user-A', 1000, NOW);
        await expect(checkUserQuota('user-A', NOW)).rejects.toThrow(QuotaExceededError);
    });

    it('사용자 격리 — A 소진이 B 에 영향 없음', async () => {
        await recordUserUsage('user-A', 2000, NOW);
        await expect(checkUserQuota('user-A', NOW)).rejects.toThrow(QuotaExceededError);
        await expect(checkUserQuota('user-B', NOW)).resolves.toBeUndefined();
    });

    it('비인증(undefined/guest) → enforcement skip', async () => {
        await recordUserUsage(undefined, 99999, NOW);
        await recordUserUsage('guest', 99999, NOW);
        await expect(checkUserQuota(undefined, NOW)).resolves.toBeUndefined();
        await expect(checkUserQuota('guest', NOW)).resolves.toBeUndefined();
    });

    it('다른 시간 버킷은 독립 (윈도우 리셋)', async () => {
        await recordUserUsage('user-A', 1000, NOW);
        await expect(checkUserQuota('user-A', NOW)).rejects.toThrow(QuotaExceededError);
        // 1시간 뒤 → 다른 hour 버킷 → 통과
        await expect(checkUserQuota('user-A', NOW + 60 * 60 * 1000)).resolves.toBeUndefined();
    });
});
