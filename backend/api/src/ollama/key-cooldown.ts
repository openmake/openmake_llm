/**
 * ============================================================
 * KeyCooldownTracker - API 키 실패 기록 및 쿨다운 관리
 * ============================================================
 *
 * API 키의 실패 횟수와 시각을 추적하고, 쿨다운 기간(5분) 동안
 * 해당 키 사용을 회피하도록 판단 로직을 제공합니다.
 * DB 영속화를 통해 서버 재시작 시에도 상태를 유지합니다.
 *
 * @module ollama/key-cooldown
 */

import { getPool } from '../data/models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('KeyCooldownTracker');

/** 키별 실패 기록 */
export interface KeyFailureRecord {
    count: number;
    lastFail: Date;
}

/**
 * API 키 쿨다운 추적기
 *
 * 각 키 인덱스별 실패 횟수/시각을 관리하고,
 * 5분 쿨다운 기반으로 키 사용 가능 여부를 판단합니다.
 */
export class KeyCooldownTracker {
    /** 키별 실패 기록 (인덱스 -> {실패 횟수, 마지막 실패 시각}) */
    private keyFailures: Map<number, KeyFailureRecord> = new Map();

    /** 쿨다운 시간(ms) — 5분 */
    private readonly cooldownMs = 5 * 60 * 1000;

    /**
     * Fire-and-forget DB operation — silently falls back to cache-only on failure
     */
    private dbWrite(text: string, params: (string | number | null)[]): void {
        try {
            getPool().query(text, params).catch(err => {
                logger.warn('DB write failed (cache-only mode):', err instanceof Error ? err.message : String(err));
            });
        } catch (_e) {
            // getPool() may throw if DB not initialized — silently ignore
        }
    }

    /**
     * DB에서 실패 기록을 로드하여 캐시를 워밍합니다 (비동기, 논블로킹).
     */
    warmCacheFromDb(): void {
        try {
            getPool().query('SELECT key_index, fail_count, last_fail_at FROM api_key_failures')
                .then(result => {
                    for (const row of result.rows) {
                        const r = row as { key_index: number; fail_count: number; last_fail_at: string };
                        this.keyFailures.set(r.key_index, {
                            count: r.fail_count,
                            lastFail: new Date(r.last_fail_at)
                        });
                    }
                    if (result.rows.length > 0) {
                        logger.info(`DB에서 ${result.rows.length}개 실패 기록 캐시 로드 완료`);
                    }
                })
                .catch(err => {
                    logger.warn('DB 캐시 워밍 실패 (캐시 전용 모드):', err instanceof Error ? err.message : String(err));
                });
        } catch (_e) {
            // getPool() may throw if DB not initialized — silently ignore
        }
    }

    /**
     * 특정 키 인덱스의 실패를 기록합니다.
     */
    recordFailure(keyIndex: number): void {
        const currentFailure = this.keyFailures.get(keyIndex) || { count: 0, lastFail: new Date() };
        currentFailure.count++;
        currentFailure.lastFail = new Date();
        this.keyFailures.set(keyIndex, currentFailure);

        this.dbWrite(
            `INSERT INTO api_key_failures (key_index, fail_count, last_fail_at, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key_index) DO UPDATE SET fail_count = $2, last_fail_at = $3, updated_at = NOW()`,
            [keyIndex, currentFailure.count, currentFailure.lastFail.toISOString()]
        );
    }

    /**
     * 특정 키 인덱스의 실패 기록을 삭제합니다 (성공 시 호출).
     */
    clearFailure(keyIndex: number): void {
        this.keyFailures.delete(keyIndex);
        this.dbWrite('DELETE FROM api_key_failures WHERE key_index = $1', [keyIndex]);
    }

    /**
     * 모든 실패 기록을 초기화합니다.
     */
    clearAll(): void {
        this.keyFailures.clear();
        this.dbWrite('DELETE FROM api_key_failures', []);
    }

    /**
     * 특정 키가 쿨다운 중인지 확인합니다.
     *
     * @returns true면 쿨다운 중 (사용 불가), false면 사용 가능
     */
    isInCooldown(keyIndex: number): boolean {
        const failure = this.keyFailures.get(keyIndex);
        if (!failure) return false;
        return (Date.now() - failure.lastFail.getTime()) <= this.cooldownMs;
    }

    /**
     * 특정 키의 실패 기록을 반환합니다.
     */
    getFailureRecord(keyIndex: number): KeyFailureRecord | undefined {
        return this.keyFailures.get(keyIndex);
    }

    /**
     * 현재 쿨다운 중인 키 개수를 반환합니다.
     */
    getKeysInCooldownCount(totalKeys: number): number {
        const now = Date.now();
        let count = 0;

        for (let i = 0; i < totalKeys; i++) {
            const failureRecord = this.keyFailures.get(i);
            if (failureRecord) {
                const resetTime = failureRecord.lastFail.getTime() + this.cooldownMs;
                if (resetTime > now) {
                    count++;
                }
            }
        }

        return count;
    }

    /**
     * 모든 키가 쿨다운 상태일 때, 가장 빨리 사용 가능한 시간을 반환합니다.
     *
     * @returns null이면 최소 하나의 키가 사용 가능, Date면 모든 키 쿨다운 중
     */
    getNextResetTime(totalKeys: number): Date | null {
        if (totalKeys === 0) return null;

        const now = Date.now();
        let allKeysInCooldown = true;
        let earliestResetTime: number = Infinity;

        for (let i = 0; i < totalKeys; i++) {
            const failureRecord = this.keyFailures.get(i);

            if (!failureRecord) {
                allKeysInCooldown = false;
                break;
            }

            const resetTime = failureRecord.lastFail.getTime() + this.cooldownMs;

            if (resetTime <= now) {
                allKeysInCooldown = false;
                break;
            }

            if (resetTime < earliestResetTime) {
                earliestResetTime = resetTime;
            }
        }

        if (allKeysInCooldown && earliestResetTime !== Infinity) {
            return new Date(earliestResetTime);
        }

        return null;
    }
}
