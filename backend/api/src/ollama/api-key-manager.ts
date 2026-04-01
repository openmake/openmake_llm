/**
 * ============================================================
 * ApiKeyManager - Cloud API Key 자동 로테이션 관리자
 * ============================================================
 *
 * 다수의 Cloud API 키를 관리하고, 장애 발생 시 자동으로 다음 키로 전환합니다.
 * GV 병렬 처리를 위한 키-모델 쌍 매핑도 지원합니다.
 *
 * 내부적으로 KeyPool(키 로딩/풀 관리)과 KeyCooldownTracker(실패/쿨다운 추적)를
 * 조합하여 기존 인터페이스를 유지합니다.
 *
 * @module ollama/api-key-manager
 * @see {@link ./key-pool} 키 풀 로딩 및 라운드로빈 관리
 * @see {@link ./key-cooldown} 실패 기록 및 쿨다운 판단
 */

import { createLogger } from '../utils/logger';
<<<<<<< HEAD
import { errorMessage } from '../utils/error-message';
=======
import { KeyPool } from './key-pool';
import { KeyCooldownTracker } from './key-cooldown';

// Re-export sub-modules for direct access
export { KeyPool } from './key-pool';
export { KeyCooldownTracker } from './key-cooldown';
export type { KeyFailureRecord } from './key-cooldown';
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78

const logger = createLogger('ApiKeyManager');

/**
 * API 키와 대응 모델의 쌍 (GV 병렬 처리용)
 * @interface KeyModelPair
 */
export interface KeyModelPair {
    /** API 키 문자열 */
    key: string;
    /** 이 키에 할당된 모델 이름 */
    model: string;
    /** 키 인덱스 (0-based) */
    index: number;
}

/**
 * ApiKeyManager 초기화 설정
 * @interface ApiKeyConfig
 */
export interface ApiKeyConfig {
    /** API 키 배열 */
    keys: string[];
    /** 각 키에 대응하는 모델 배열 (인덱스 매핑) */
    models?: string[];
    /** SSH 키 (Ollama SSH 터널링용) */
    sshKey?: string;
}

/**
 * Cloud API Key 자동 로테이션 관리자
 *
 * 다수의 Cloud API 키를 라운드 로빈 + 쿨다운 회피 방식으로 관리합니다.
 * 각 키에 개별 모델을 매핑하여 GV 병렬 생성을 지원합니다.
 *
 * 로테이션 알고리즘:
 * - 연속 실패 2회 또는 인증 에러(401/403/429) -> 즉시 다음 키로 전환
 * - 다음 키 탐색 시 최근 5분 내 실패 기록이 없는 키를 우선 선택
 * - 성공 시 실패 카운트 및 해당 키의 실패 기록 초기화
 *
 * @class ApiKeyManager
 */
export class ApiKeyManager {
    /** 키 풀 관리자 */
    private pool: KeyPool;
    /** 쿨다운 추적기 */
    private cooldown: KeyCooldownTracker;
    /** 현재 활성 키의 인덱스 (0-based) */
    private currentKeyIndex = 0;
    /** 현재 키의 연속 실패 횟수 */
    private failureCount = 0;
    /** 자동 로테이션 트리거 실패 횟수 임계값 */
    private readonly maxFailures = 2;
    /** 마지막 키 전환(failover) 시각 */
    private lastFailoverTime: Date | null = null;
<<<<<<< HEAD
    /** 키별 실패 기록 (인덱스 -> {실패 횟수, 마지막 실패 시각}) — 쿨다운 판단에 사용 */
    private keyFailures: Map<number, { count: number; lastFail: Date }> = new Map();
    /** 🆕 키풀 라운드로빈 포인터 (getNextAvailableKey용, per-instance 키 할당에 사용) */
    private roundRobinIndex = 0;

    /**
     * Fire-and-forget DB operation — silently falls back to cache-only on failure
     */
    private dbWrite(text: string, params: (string | number | null)[]): void {
        try {
            getPool().query(text, params).catch(err => {
                logger.warn('DB write failed (cache-only mode):', errorMessage(err));
            });
        } catch (_e) {
            // getPool() may throw if DB not initialized — silently ignore
        }
    }

    /**
     * Warm keyFailures cache from DB (called once during construction)
     */
    private warmCacheFromDb(): void {
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
                    logger.warn('DB 캐시 워밍 실패 (캐시 전용 모드):', errorMessage(err));
                });
        } catch (_e) {
            // getPool() may throw if DB not initialized — silently ignore
        }
    }

    /**
     * 원시 키 배열에서 빈 문자열, 비문자열 등 유효하지 않은 키를 필터링합니다.
     *
     * @param rawKeys - 원시 API 키 배열
     * @param source - 키 출처 설명 (로그용)
     * @returns 유효한 키만 포함된 배열
     * @private
     */
    private sanitizeKeys(rawKeys: string[], source: string): string[] {
        const sanitized: string[] = [];
        rawKeys.forEach((rawKey, idx) => {
            if (typeof rawKey !== 'string') {
                logger.warn(`⚠️ ${source} key ${idx + 1} 무시됨: 문자열이 아닙니다.`);
                return;
            }

            const trimmed = rawKey.trim();
            if (!trimmed) {
                logger.warn(`⚠️ ${source} key ${idx + 1} 무시됨: 비어있거나 공백입니다.`);
                return;
            }

            sanitized.push(trimmed);
        });
        return sanitized;
    }
=======
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78

    /**
     * ApiKeyManager 인스턴스를 생성합니다.
     *
     * @param config - 초기화 설정 (부분 적용 가능, 미지정 시 환경변수에서 자동 로드)
     */
    constructor(config?: Partial<ApiKeyConfig>) {
        this.pool = new KeyPool(config ? {
            keys: config.keys,
            models: config.models,
            sshKey: config.sshKey
        } : undefined);

<<<<<<< HEAD
        try {
            if (config?.keys && config.keys.length > 0) {
                this.keys = this.sanitizeKeys(config.keys, 'config');
            } else {
                this.keys = this.loadKeysFromEnv();
            }
        } catch (error) {
            logger.warn(`⚠️ API 키 초기화 실패, 빈 키 목록으로 진행: ${errorMessage(error)}`);
            this.keys = [];
        }

        if (this.keys.length === 0) {
            logger.warn('⚠️ 유효한 API 키가 구성되지 않았습니다. 인증 없이 요청을 시도합니다.');
        }

        // 🆕 각 키에 대응하는 모델 로드
        if (config?.models && config.models.length > 0) {
            this.models = config.models;
        } else {
            this.models = envConfig.ollamaModels || [];
        }

        this.sshKey = config?.sshKey || envConfig.ollamaSshKey || undefined;

        logger.info(`🔑 초기화됨 - ${this.keys.length}개 API 키, ${this.models.length}개 모델 등록`);
        this.keys.forEach((key, idx) => {
            const model = this.models[idx] || envConfig.ollamaDefaultModel || 'default';
            logger.info(`  Key ${idx + 1}: ****${key.substring(key.length - 4)} → Model: ${model}`);
        });

        // Warm cache from DB (async, non-blocking)
        this.warmCacheFromDb();
    }

    /**
     * 🆕 환경변수에서 동적으로 API 키 로드
     * OLLAMA_API_KEY_1, OLLAMA_API_KEY_2, ... OLLAMA_API_KEY_N 순서로 탐색
     * 레거시 지원: OLLAMA_API_KEY_PRIMARY, OLLAMA_API_KEY_SECONDARY
     */
    private loadKeysFromEnv(): string[] {
        const keys: string[] = [];

        const numberedKeys = Object.entries(process.env)
            .map(([name, value]) => {
                const match = /^OLLAMA_API_KEY_(\d+)$/.exec(name);
                if (!match) return null;
                return { index: Number.parseInt(match[1], 10), value };
            })
            .filter((entry): entry is { index: number; value: string | undefined } => entry !== null)
            .sort((a, b) => a.index - b.index);

        for (const entry of numberedKeys) {
            if (typeof entry.value !== 'string' || entry.value.trim() === '') {
                logger.warn(`⚠️ env OLLAMA_API_KEY_${entry.index} 무시됨: 비어있거나 공백입니다.`);
                continue;
            }
            keys.push(entry.value.trim());
        }

        // 레거시 형식 지원 (새 형식에 키가 없을 때만)
        if (keys.length === 0) {
            const cfg = getConfig();
            const primary = cfg.ollamaApiKeyPrimary || cfg.ollamaApiKey;
            const secondary = cfg.ollamaApiKeySecondary;

            if (typeof primary === 'string') {
                if (primary.trim() !== '') {
                    keys.push(primary.trim());
                } else {
                    logger.warn('⚠️ env legacy primary key 무시됨: 비어있거나 공백입니다.');
                }
            }
            if (typeof secondary === 'string') {
                if (secondary.trim() !== '') {
                    keys.push(secondary.trim());
                } else {
                    logger.warn('⚠️ env legacy secondary key 무시됨: 비어있거나 공백입니다.');
                }
            }
        }

        return keys;
=======
        this.cooldown = new KeyCooldownTracker();
        this.cooldown.warmCacheFromDb();
>>>>>>> fbe49389978ecfeb4fc6d2df399c18138a7fed78
    }

    /**
     * 현재 사용할 API 키 반환
     */
    getCurrentKey(): string {
        if (!this.pool.hasValidKey()) return '';
        return this.pool.getKeyByIndex(this.currentKeyIndex);
    }

    /**
     * 현재 키에 대응하는 모델 반환
     */
    getCurrentModel(): string {
        return this.pool.getModelByIndex(this.currentKeyIndex);
    }

    /**
     * 현재 키 인덱스 반환
     */
    getCurrentKeyIndex(): number {
        return this.currentKeyIndex;
    }

    /**
     * 전체 키 개수 반환
     */
    getTotalKeys(): number {
        return this.pool.getTotalKeys();
    }

    /**
     * API 키가 설정되어 있는지 확인
     */
    hasValidKey(): boolean {
        return this.pool.hasValidKey();
    }

    /**
     * SSH 키 반환
     */
    getSshKey(): string | undefined {
        return this.pool.getSshKey();
    }

    /**
     * 특정 인덱스의 Authorization 헤더 생성 (GV 병렬 처리용)
     */
    getAuthHeadersForIndex(index: number): Record<string, string> {
        return this.pool.getAuthHeadersForIndex(index);
    }

    /**
     * 요청 성공 시 호출
     */
    reportSuccess(): void {
        this.failureCount = 0;
        this.cooldown.clearFailure(this.currentKeyIndex);
    }

    /**
     * 요청 실패 시 호출 - 자동 로테이션 처리
     */
    reportFailure(error?: unknown): boolean {
        this.failureCount++;
        const err = error as { response?: { status?: number }; code?: string } | undefined;
        const errorCode = err?.response?.status || err?.code || 'unknown';

        this.cooldown.recordFailure(this.currentKeyIndex);

        const masked = this.pool.getMaskedKey(this.currentKeyIndex);
        logger.warn(`Key ${this.currentKeyIndex + 1} (${masked}) 실패 - 코드: ${errorCode}`);

        const isAuthError = errorCode === 401 || errorCode === 403 || errorCode === 429;

        if (this.failureCount >= this.maxFailures || isAuthError) {
            return this.rotateToNextKey();
        }

        return false;
    }

    /**
     * 다음 사용 가능한 키로 순환합니다.
     */
    private rotateToNextKey(): boolean {
        const totalKeys = this.pool.getTotalKeys();
        if (totalKeys <= 1) {
            logger.error(`사용 가능한 다른 키가 없습니다.`);
            return false;
        }

        const previousIndex = this.currentKeyIndex;

        // 사용 가능한 다음 키 찾기 (최근 실패 기록이 없는 키 우선)
        let nextIndex = (this.currentKeyIndex + 1) % totalKeys;
        let attempts = 0;

        while (attempts < totalKeys) {
            if (!this.cooldown.isInCooldown(nextIndex)) {
                break;
            }
            nextIndex = (nextIndex + 1) % totalKeys;
            attempts++;
        }

        this.currentKeyIndex = nextIndex;
        this.failureCount = 0;
        this.lastFailoverTime = new Date();

        const previousMasked = this.pool.getMaskedKey(previousIndex);
        const newMasked = this.pool.getMaskedKey(nextIndex);
        const newModel = this.getCurrentModel();
        logger.info(`키 전환: Key ${previousIndex + 1} (${previousMasked}) → Key ${nextIndex + 1} (${newMasked}) [Model: ${newModel}]`);

        return true;
    }

    /**
     * 첫 번째 키로 리셋
     */
    reset(): void {
        this.currentKeyIndex = 0;
        this.failureCount = 0;
        this.lastFailoverTime = null;
        this.cooldown.clearAll();
        logger.info(`Key 1으로 리셋됨`);
    }

    /**
     * 특정 인덱스로 강제 전환 (GV용)
     */
    setKeyIndex(index: number): boolean {
        if (index < 0 || index >= this.pool.getTotalKeys()) {
            logger.error(`유효하지 않은 인덱스: ${index}`);
            return false;
        }
        this.currentKeyIndex = index;
        this.failureCount = 0;
        const masked = this.pool.getMaskedKey(index);
        const model = this.getCurrentModel();
        logger.info(`Key ${index + 1} (${masked}) 강제 선택 [Model: ${model}]`);
        return true;
    }

    /**
     * 특정 키 인덱스의 실패를 기록합니다 (싱글톤 로테이션 트리거 없이).
     * Per-instance key binding에서 사용됩니다.
     */
    recordKeyFailure(keyIndex: number, error?: unknown): void {
        if (keyIndex < 0 || keyIndex >= this.pool.getTotalKeys()) return;

        const err = error as { response?: { status?: number }; code?: string } | undefined;
        const errorCode = err?.response?.status || err?.code || 'unknown';

        this.cooldown.recordFailure(keyIndex);

        const masked = this.pool.getMaskedKey(keyIndex);
        logger.warn(`Key ${keyIndex + 1} (${masked}) 실패 기록 - 코드: ${errorCode}`);
    }

    /**
     * 특정 키 인덱스의 성공을 기록합니다 (per-instance용).
     */
    recordKeySuccess(keyIndex: number): void {
        if (keyIndex < 0 || keyIndex >= this.pool.getTotalKeys()) return;
        this.cooldown.clearFailure(keyIndex);
    }

    /**
     * 키풀에서 다음 사용 가능한 키 인덱스를 라운드로빈으로 선택합니다.
     *
     * @param excludeIndex - 제외할 키 인덱스 (현재 실패한 키, 선택적)
     * @returns 사용 가능한 키 인덱스 (0-based), 없으면 -1
     */
    getNextAvailableKey(excludeIndex?: number): number {
        return this.pool.getNextAvailableKey(
            (idx) => !this.cooldown.isInCooldown(idx),
            excludeIndex
        );
    }

    /**
     * 특정 키 인덱스의 API 키 문자열을 반환합니다.
     */
    getKeyByIndex(index: number): string {
        return this.pool.getKeyByIndex(index);
    }

    /**
     * 모든 키가 쿨다운 상태인지 확인하고, 가장 빨리 사용 가능한 시간 반환
     */
    getNextResetTime(): Date | null {
        return this.cooldown.getNextResetTime(this.pool.getTotalKeys());
    }

    /**
     * 현재 쿨다운 중인 키 개수 반환
     */
    getKeysInCooldownCount(): number {
        return this.cooldown.getKeysInCooldownCount(this.pool.getTotalKeys());
    }

    /**
     * 모든 키가 소진되었는지 확인
     */
    isAllKeysExhausted(): boolean {
        return this.getNextResetTime() !== null;
    }

    /**
     * 현재 상태 조회
     */
    getStatus(): {
        activeKeyIndex: number;
        totalKeys: number;
        failures: number;
        lastFailover: Date | null;
        keyStatuses: { index: number; model: string; failCount: number; lastFail: Date | null }[];
    } {
        const keyInfos = this.pool.getKeyInfos();
        const keyStatuses = keyInfos.map(info => {
            const failure = this.cooldown.getFailureRecord(info.index);
            return {
                index: info.index,
                model: info.model,
                failCount: failure?.count || 0,
                lastFail: failure?.lastFail || null
            };
        });

        return {
            activeKeyIndex: this.currentKeyIndex,
            totalKeys: this.pool.getTotalKeys(),
            failures: this.failureCount,
            lastFailover: this.lastFailoverTime,
            keyStatuses
        };
    }

    /**
     * Authorization 헤더 생성
     */
    getAuthHeaders(): Record<string, string> {
        const key = this.getCurrentKey();
        if (!key) return {};

        return {
            'Authorization': `Bearer ${key}`
        };
    }
}

// ============================================
// 싱글톤 인스턴스 관리
// ============================================

/** ApiKeyManager 싱글톤 인스턴스 */
let apiKeyManager: ApiKeyManager | null = null;

/**
 * ApiKeyManager 싱글톤 인스턴스를 반환합니다.
 * 최초 호출 시 환경변수에서 키를 로드하여 인스턴스를 생성합니다.
 */
export function getApiKeyManager(): ApiKeyManager {
    if (!apiKeyManager) {
        apiKeyManager = new ApiKeyManager();
    }
    return apiKeyManager;
}

/**
 * ApiKeyManager 싱글톤 인스턴스를 초기화합니다.
 * 다음 getApiKeyManager() 호출 시 새 인스턴스가 생성됩니다.
 */
export function resetApiKeyManager(): void {
    apiKeyManager = null;
}
