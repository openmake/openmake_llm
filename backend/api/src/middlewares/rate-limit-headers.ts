/**
 * Rate Limit Headers Middleware
 * 
 * OpenAI 스타일 x-ratelimit-* 헤더를 응답에 추가합니다.
 * 
 * Headers:
 *   x-ratelimit-limit-requests: RPM 한도
 *   x-ratelimit-limit-tokens: TPM 한도
 *   x-ratelimit-remaining-requests: 남은 RPM
 *   x-ratelimit-remaining-tokens: 남은 TPM
 *   x-ratelimit-reset-requests: RPM 리셋 시각
 *   x-ratelimit-reset-tokens: TPM 리셋 시각
 * 
 * @see docs/api/API_KEY_SERVICE_PLAN.md §4 Rate Limiting
 */

import { Request, Response, NextFunction } from 'express';
import { API_KEY_TIER_LIMITS, ApiKeyTier } from '../data/models/unified-database';

/** 인메모리 TPM 카운터 (키 ID → { tokens, windowStart }) */
const tpmCounters: Map<string, { tokens: number; windowStart: number }> = new Map();

/** RPM 카운터 (키 ID → { count, windowStart }) */
const rpmCounters: Map<string, { count: number; windowStart: number }> = new Map();

const WINDOW_MS = 60 * 1000; // 1분

/**
 * 카운터 윈도우 확인/리셋
 */
function getOrResetCounter<T extends { windowStart: number }>(
    map: Map<string, T>,
    key: string,
    defaultFactory: () => T
): T {
    const now = Date.now();
    let counter = map.get(key);

    if (!counter || (now - counter.windowStart) >= WINDOW_MS) {
        counter = defaultFactory();
        counter.windowStart = now;
        map.set(key, counter);
    }

    return counter;
}

/**
 * x-ratelimit-* 헤더 미들웨어
 * 
 * API Key 인증된 요청에 OpenAI 호환 Rate Limit 헤더를 추가합니다.
 * 비인증 요청은 스킵합니다.
 */
export function rateLimitHeaders(req: Request, res: Response, next: NextFunction): void {
    // API Key 인증이 아닌 경우 스킵
    if (!req.apiKeyRecord || !req.apiKeyId) {
        next();
        return;
    }

    const tier: ApiKeyTier = req.apiKeyRecord.rate_limit_tier || 'free';
    const limits = API_KEY_TIER_LIMITS[tier];
    const keyId = req.apiKeyId;
    const now = Date.now();

    // RPM 카운터
    const rpmCounter = getOrResetCounter(rpmCounters, keyId, () => ({
        count: 0,
        windowStart: now,
    }));
    rpmCounter.count++;

    // TPM 카운터 (요청 시점에는 토큰 수를 모르므로 현재 값만 참조)
    const tpmCounter = getOrResetCounter(tpmCounters, keyId, () => ({
        tokens: 0,
        windowStart: now,
    }));

    // 리셋 시각 계산
    const rpmResetMs = WINDOW_MS - (now - rpmCounter.windowStart);
    const tpmResetMs = WINDOW_MS - (now - tpmCounter.windowStart);
    const rpmResetDate = new Date(now + rpmResetMs).toISOString();
    const tpmResetDate = new Date(now + tpmResetMs).toISOString();

    // OpenAI 호환 헤더 설정
    res.setHeader('x-ratelimit-limit-requests', String(limits.rpm));
    res.setHeader('x-ratelimit-limit-tokens', String(limits.tpm));
    res.setHeader('x-ratelimit-remaining-requests', String(Math.max(0, limits.rpm - rpmCounter.count)));
    res.setHeader('x-ratelimit-remaining-tokens', String(Math.max(0, limits.tpm - tpmCounter.tokens)));
    res.setHeader('x-ratelimit-reset-requests', rpmResetDate);
    res.setHeader('x-ratelimit-reset-tokens', tpmResetDate);

    next();
}

/**
 * 응답 완료 후 TPM 카운터 업데이트
 * ChatService에서 호출하여 실제 사용된 토큰 수를 기록합니다.
 * 
 * @param keyId - API Key ID
 * @param tokens - 사용된 토큰 수
 */
export function recordTokenUsage(keyId: string, tokens: number): void {
    const now = Date.now();
    const tpmCounter = getOrResetCounter(tpmCounters, keyId, () => ({
        tokens: 0,
        windowStart: now,
    }));
    tpmCounter.tokens += tokens;
}

/**
 * TPM 한도 초과 여부 확인
 * 
 * @param keyId - API Key ID
 * @param tier - API Key 등급
 * @returns true이면 한도 초과
 */
export function isTPMExceeded(keyId: string, tier: ApiKeyTier): boolean {
    const limits = API_KEY_TIER_LIMITS[tier];
    const now = Date.now();
    const tpmCounter = getOrResetCounter(tpmCounters, keyId, () => ({
        tokens: 0,
        windowStart: now,
    }));
    return tpmCounter.tokens >= limits.tpm;
}
