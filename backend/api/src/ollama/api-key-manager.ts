/**
 * ============================================================
 * ApiKeyManager - Cloud API Key 자동 로테이션 관리자
 * ============================================================
 *
 * 다수의 Cloud API 키를 관리하고, 장애 발생 시 자동으로 다음 키로 전환합니다.
 * A2A 병렬 처리를 위한 키-모델 쌍 매핑도 지원합니다.
 *
 * 내부적으로 KeyPool(키 로딩/풀 관리)과 KeyCooldownTracker(실패/쿨다운 추적)를
 * 조합하여 기존 인터페이스를 유지합니다.
 *
 * @module ollama/api-key-manager
 * @see {@link ./key-pool} 키 풀 로딩 및 라운드로빈 관리
 * @see {@link ./key-cooldown} 실패 기록 및 쿨다운 판단
 */

import { createLogger } from '../utils/logger';
import { KeyPool } from './key-pool';
import { KeyCooldownTracker } from './key-cooldown';

// Re-export sub-modules for direct access
export { KeyPool } from './key-pool';
export { KeyCooldownTracker } from './key-cooldown';
export type { KeyFailureRecord } from './key-cooldown';

const logger = createLogger('ApiKeyManager');

/**
 * API 키와 대응 모델의 쌍 (A2A 병렬 처리용)
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
 * 각 키에 개별 모델을 매핑하여 A2A 병렬 생성을 지원합니다.
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

        this.cooldown = new KeyCooldownTracker();
        this.cooldown.warmCacheFromDb();
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
     * 특정 인덱스의 Authorization 헤더 생성 (A2A 병렬 처리용)
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
     * 특정 인덱스로 강제 전환 (A2A용)
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
