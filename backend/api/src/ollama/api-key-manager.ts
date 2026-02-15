/**
 * ============================================================
 * ApiKeyManager - Cloud API Key 자동 로테이션 관리자
 * ============================================================
 *
 * 다수의 Cloud API 키를 관리하고, 장애 발생 시 자동으로 다음 키로 전환합니다.
 * A2A 병렬 처리를 위한 키-모델 쌍 매핑도 지원합니다.
 *
 * @module ollama/api-key-manager
 * @description
 * - 무제한 API 키 동적 로드 (OLLAMA_API_KEY_1, _2, ..., _N 환경변수)
 * - 429/401/403 에러 시 자동 키 로테이션 (라운드 로빈 + 쿨다운 회피)
 * - 5분 쿨다운: 실패한 키는 5분간 스킵 후 재시도
 * - 키-모델 쌍 매핑으로 A2A 병렬 생성 지원
 * - 레거시 형식 호환 (OLLAMA_API_KEY_PRIMARY, _SECONDARY)
 *
 * @description 키 로테이션 알고리즘:
 * 1. 요청 실패 시 failureCount 증가
 * 2. failureCount >= maxFailures(2) 또는 인증 에러(401/403/429) 시 즉시 rotateToNextKey() 호출
 * 3. rotateToNextKey()는 다음 인덱스부터 순회하며 쿨다운(5분) 지난 키를 탐색
 * 4. 모든 키가 쿨다운 상태이면 가장 빨리 복구되는 키로 전환
 * 5. 성공 시 failureCount 초기화 및 해당 키의 실패 기록 삭제
 */

import { getConfig } from '../config/env';

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
 * - 연속 실패 2회 또는 인증 에러(401/403/429) → 즉시 다음 키로 전환
 * - 다음 키 탐색 시 최근 5분 내 실패 기록이 없는 키를 우선 선택
 * - 성공 시 실패 카운트 및 해당 키의 실패 기록 초기화
 *
 * @class ApiKeyManager
 */
export class ApiKeyManager {
    /** 등록된 API 키 배열 */
    private keys: string[] = [];
    /** 각 키에 대응하는 모델 이름 배열 (인덱스 매핑) */
    private models: string[] = [];
    /** 현재 활성 키의 인덱스 (0-based) */
    private currentKeyIndex = 0;
    /** SSH 키 (Ollama SSH 터널링용, 선택적) */
    private sshKey: string | undefined;
    /** 현재 키의 연속 실패 횟수 */
    private failureCount = 0;
    /** 자동 로테이션 트리거 실패 횟수 임계값 (2회 = 빠른 스와핑) */
    private readonly maxFailures = 2;
    /** 마지막 키 전환(failover) 시각 */
    private lastFailoverTime: Date | null = null;
    /** 키별 실패 기록 (인덱스 -> {실패 횟수, 마지막 실패 시각}) — 쿨다운 판단에 사용 */
    private keyFailures: Map<number, { count: number; lastFail: Date }> = new Map();

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
                console.warn(`[ApiKeyManager] ⚠️ ${source} key ${idx + 1} 무시됨: 문자열이 아닙니다.`);
                return;
            }

            const trimmed = rawKey.trim();
            if (!trimmed) {
                console.warn(`[ApiKeyManager] ⚠️ ${source} key ${idx + 1} 무시됨: 비어있거나 공백입니다.`);
                return;
            }

            sanitized.push(trimmed);
        });
        return sanitized;
    }

    /**
     * ApiKeyManager 인스턴스를 생성합니다.
     *
     * 초기화 순서:
     * 1. config.keys가 있으면 사용, 없으면 환경변수에서 동적 로드
     * 2. 각 키에 대응하는 모델 로드 (config.models 또는 환경변수)
     * 3. SSH 키 로드
     * 4. 초기화 결과 로그 출력 (키 마스킹 처리)
     *
     * @param config - 초기화 설정 (부분 적용 가능, 미지정 시 환경변수에서 자동 로드)
     */
    constructor(config?: Partial<ApiKeyConfig>) {
        const envConfig = getConfig();

        try {
            if (config?.keys && config.keys.length > 0) {
                this.keys = this.sanitizeKeys(config.keys, 'config');
            } else {
                this.keys = this.loadKeysFromEnv();
            }
        } catch (error) {
            console.warn(`[ApiKeyManager] ⚠️ API 키 초기화 실패, 빈 키 목록으로 진행: ${(error instanceof Error ? error.message : String(error))}`);
            this.keys = [];
        }

        if (this.keys.length === 0) {
            console.warn('[ApiKeyManager] ⚠️ 유효한 API 키가 구성되지 않았습니다. 인증 없이 요청을 시도합니다.');
        }

        // 🆕 각 키에 대응하는 모델 로드
        if (config?.models && config.models.length > 0) {
            this.models = config.models;
        } else {
            this.models = envConfig.ollamaModels || [];
        }

        this.sshKey = config?.sshKey || envConfig.ollamaSshKey || undefined;

        console.log(`[ApiKeyManager] 🔑 초기화됨 - ${this.keys.length}개 API 키, ${this.models.length}개 모델 등록`);
        this.keys.forEach((key, idx) => {
            const model = this.models[idx] || envConfig.ollamaDefaultModel || 'default';
            console.log(`[ApiKeyManager]   Key ${idx + 1}: ****${key.substring(key.length - 4)} → Model: ${model}`);
        });
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
                console.warn(`[ApiKeyManager] ⚠️ env OLLAMA_API_KEY_${entry.index} 무시됨: 비어있거나 공백입니다.`);
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
                    console.warn('[ApiKeyManager] ⚠️ env legacy primary key 무시됨: 비어있거나 공백입니다.');
                }
            }
            if (typeof secondary === 'string') {
                if (secondary.trim() !== '') {
                    keys.push(secondary.trim());
                } else {
                    console.warn('[ApiKeyManager] ⚠️ env legacy secondary key 무시됨: 비어있거나 공백입니다.');
                }
            }
        }

        return keys;
    }

    /**
     * 현재 사용할 API 키 반환
     */
    getCurrentKey(): string {
        if (this.keys.length === 0) return '';
        return this.keys[this.currentKeyIndex];
    }

    /**
     * 🆕 현재 키에 대응하는 모델 반환
     */
    getCurrentModel(): string {
        if (this.models.length === 0 || this.currentKeyIndex >= this.models.length) {
            return getConfig().ollamaDefaultModel;
        }
        return this.models[this.currentKeyIndex];
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
        return this.keys.length;
    }

    /**
     * API 키가 설정되어 있는지 확인
     */
    hasValidKey(): boolean {
        return this.keys.length > 0;
    }

    /**
     * SSH 키 반환
     */
    getSshKey(): string | undefined {
        return this.sshKey;
    }

    /**
     * 🆕 특정 인덱스의 키-모델 쌍 반환 (A2A 병렬 처리용)
     */
    getKeyModelPair(index: number): KeyModelPair | null {
        if (index < 0 || index >= this.keys.length) return null;
        
        return {
            key: this.keys[index],
            model: this.models[index] || getConfig().ollamaDefaultModel,
            index
        };
    }

    /**
     * 🆕 모든 키-모델 쌍 반환 (A2A 병렬 처리용)
     */
    getAllKeyModelPairs(): KeyModelPair[] {
        const defaultModel = getConfig().ollamaDefaultModel;
        return this.keys.map((key, index) => ({
            key,
            model: this.models[index] || defaultModel,
            index
        }));
    }

    /**
     * 🆕 특정 인덱스의 Authorization 헤더 생성 (A2A 병렬 처리용)
     */
    getAuthHeadersForIndex(index: number): Record<string, string> {
        if (index < 0 || index >= this.keys.length) return {};
        return {
            'Authorization': `Bearer ${this.keys[index]}`
        };
    }

    /**
     * 요청 성공 시 호출
     */
    reportSuccess(): void {
        this.failureCount = 0;
        // 현재 키의 실패 기록 초기화
        this.keyFailures.delete(this.currentKeyIndex);
    }

    /**
     * 요청 실패 시 호출 - 자동 로테이션 처리
     */
    reportFailure(error?: unknown): boolean {
        this.failureCount++;
        const err = error as { response?: { status?: number }; code?: string } | undefined;
        const errorCode = err?.response?.status || err?.code || 'unknown';

        // 현재 키의 실패 기록 업데이트
        const currentFailure = this.keyFailures.get(this.currentKeyIndex) || { count: 0, lastFail: new Date() };
        currentFailure.count++;
        currentFailure.lastFail = new Date();
        this.keyFailures.set(this.currentKeyIndex, currentFailure);

        const masked = this.getCurrentKey().substring(0, 8) + '...';
        console.warn(`[ApiKeyManager] ⚠️ Key ${this.currentKeyIndex + 1} (${masked}) 실패 - 코드: ${errorCode}`);

        // 인증 관련 에러인 경우 즉시 다음 키로 전환
        const isAuthError = errorCode === 401 || errorCode === 403 || errorCode === 429;

        if (this.failureCount >= this.maxFailures || isAuthError) {
            return this.rotateToNextKey();
        }

        return false;
    }

    /**
     * 다음 사용 가능한 키로 순환합니다.
     *
     * 로테이션 알고리즘:
     * 1. 현재 인덱스 + 1부터 순회 시작 (라운드 로빈)
     * 2. 각 키의 실패 기록 확인 — 기록 없거나 5분 쿨다운 경과 시 선택
     * 3. 모든 키가 쿨다운 상태이면 마지막 순회 결과(가장 빨리 쿨다운 끝나는 키)로 전환
     * 4. 전환 후 failureCount 초기화
     *
     * @returns 키 전환 성공 여부 (키가 1개 이하면 false)
     * @private
     */
    private rotateToNextKey(): boolean {
        if (this.keys.length <= 1) {
            console.error(`[ApiKeyManager] ❌ 사용 가능한 다른 키가 없습니다.`);
            return false;
        }

        const previousIndex = this.currentKeyIndex;

        // 사용 가능한 다음 키 찾기 (최근 실패 기록이 없는 키 우선)
        let nextIndex = (this.currentKeyIndex + 1) % this.keys.length;
        let attempts = 0;

        while (attempts < this.keys.length) {
            const failureRecord = this.keyFailures.get(nextIndex);

            // 실패 기록이 없거나 5분 이상 지난 키 찾기
            if (!failureRecord || (Date.now() - failureRecord.lastFail.getTime() > 5 * 60 * 1000)) {
                break;
            }

            nextIndex = (nextIndex + 1) % this.keys.length;
            attempts++;
        }

        this.currentKeyIndex = nextIndex;
        this.failureCount = 0;
        this.lastFailoverTime = new Date();

        const previousMasked = this.keys[previousIndex].substring(0, 8) + '...';
        const newMasked = this.getCurrentKey().substring(0, 8) + '...';
        const newModel = this.getCurrentModel();
        console.log(`[ApiKeyManager] 🔄 키 전환: Key ${previousIndex + 1} (${previousMasked}) → Key ${nextIndex + 1} (${newMasked}) [Model: ${newModel}]`);

        return true;
    }

    /**
     * 첫 번째 키로 리셋
     */
    reset(): void {
        this.currentKeyIndex = 0;
        this.failureCount = 0;
        this.lastFailoverTime = null;
        this.keyFailures.clear();
        console.log(`[ApiKeyManager] 🔄 Key 1으로 리셋됨`);
    }

    /**
     * 🆕 특정 인덱스로 강제 전환 (A2A용)
     */
    setKeyIndex(index: number): boolean {
        if (index < 0 || index >= this.keys.length) {
            console.error(`[ApiKeyManager] ❌ 유효하지 않은 인덱스: ${index}`);
            return false;
        }
        this.currentKeyIndex = index;
        this.failureCount = 0;
        const masked = this.getCurrentKey().substring(0, 8) + '...';
        const model = this.getCurrentModel();
        console.log(`[ApiKeyManager] 🎯 Key ${index + 1} (${masked}) 강제 선택 [Model: ${model}]`);
        return true;
    }

    /**
     * 🆕 모든 키가 쿨다운 상태인지 확인하고, 가장 빨리 사용 가능한 시간 반환
     * @returns null if at least one key is available, or the earliest reset time if all keys are in cooldown
     */
    getNextResetTime(): Date | null {
        if (this.keys.length === 0) {
            return null; // 키가 없으면 null 반환
        }

        const now = Date.now();
        const cooldownMs = 5 * 60 * 1000; // 5분 쿨다운 (rotateToNextKey와 동일)
        let allKeysInCooldown = true;
        let earliestResetTime: number = Infinity;

        for (let i = 0; i < this.keys.length; i++) {
            const failureRecord = this.keyFailures.get(i);
            
            if (!failureRecord) {
                // 실패 기록이 없으면 사용 가능
                allKeysInCooldown = false;
                break;
            }

            const resetTime = failureRecord.lastFail.getTime() + cooldownMs;
            
            if (resetTime <= now) {
                // 쿨다운이 끝났으면 사용 가능
                allKeysInCooldown = false;
                break;
            }

            // 가장 빠른 리셋 시간 추적
            if (resetTime < earliestResetTime) {
                earliestResetTime = resetTime;
            }
        }

        if (allKeysInCooldown && earliestResetTime !== Infinity) {
            return new Date(earliestResetTime);
        }

        return null;
    }

    /**
     * 🆕 현재 쿨다운 중인 키 개수 반환
     */
    getKeysInCooldownCount(): number {
        const now = Date.now();
        const cooldownMs = 5 * 60 * 1000;
        let count = 0;

        for (let i = 0; i < this.keys.length; i++) {
            const failureRecord = this.keyFailures.get(i);
            if (failureRecord) {
                const resetTime = failureRecord.lastFail.getTime() + cooldownMs;
                if (resetTime > now) {
                    count++;
                }
            }
        }

        return count;
    }

    /**
     * 🆕 모든 키가 소진되었는지 확인
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
        const defaultModel = getConfig().ollamaDefaultModel;
        const keyStatuses = this.keys.map((_, idx) => {
            const failure = this.keyFailures.get(idx);
            return {
                index: idx,
                model: this.models[idx] || defaultModel,
                failCount: failure?.count || 0,
                lastFail: failure?.lastFail || null
            };
        });

        return {
            activeKeyIndex: this.currentKeyIndex,
            totalKeys: this.keys.length,
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
 *
 * @returns ApiKeyManager 싱글톤 인스턴스
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
 * 테스트 또는 설정 변경 시 사용합니다.
 */
export function resetApiKeyManager(): void {
    apiKeyManager = null;
}
