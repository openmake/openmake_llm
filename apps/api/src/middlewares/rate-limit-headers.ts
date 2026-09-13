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
 */

import { API_KEY_LIMITS } from '../data/models/unified-database';

/** 인메모리 TPM 카운터 (키 ID → { tokens, windowStart }) */
const tpmCounters: Map<string, { tokens: number; windowStart: number }> = new Map();

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
 * @returns true이면 한도 초과
 */
export function isTPMExceeded(keyId: string): boolean {
    const limits = API_KEY_LIMITS;
    const now = Date.now();
    const tpmCounter = getOrResetCounter(tpmCounters, keyId, () => ({
        tokens: 0,
        windowStart: now,
    }));
    return tpmCounter.tokens >= limits.tpm;
}
