/**
 * API Key Manager with Automatic Multi-Key Rotation
 * 🆕 무제한 API 키 자동 순환 로직 (OLLAMA_API_KEY_1, _2, _3, ... _N)
 * 🆕 A2A 병렬 모델 지원: 각 키별 개별 모델 설정 (OLLAMA_MODEL_1, _2, ... _N)
 */

import { getConfig } from '../config/env';

/**
 * 키-모델 쌍 인터페이스 (A2A 병렬 처리용)
 */
export interface KeyModelPair {
    key: string;
    model: string;
    index: number;
}

export interface ApiKeyConfig {
    keys: string[];
    models?: string[];  // 각 키에 대응하는 모델 배열
    sshKey?: string;
}

export class ApiKeyManager {
    private keys: string[] = [];
    private models: string[] = [];  // 🆕 각 키에 대응하는 모델
    private currentKeyIndex = 0;
    private sshKey: string | undefined;
    private failureCount = 0;
    private readonly maxFailures = 2;  // 더 빠른 스와핑
    private lastFailoverTime: Date | null = null;
    private keyFailures: Map<number, { count: number; lastFail: Date }> = new Map();

    constructor(config?: Partial<ApiKeyConfig>) {
        const envConfig = getConfig();
        
        // 🆕 환경변수에서 동적으로 모든 API 키 로드 (OLLAMA_API_KEY_1, _2, _3, ... _N)
        if (config?.keys && config.keys.length > 0) {
            this.keys = config.keys.filter(k => k && k.trim() !== '');
        } else {
            this.keys = this.loadKeysFromEnv();
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
            const masked = key.substring(0, 8) + '...' + key.substring(key.length - 4);
            const model = this.models[idx] || envConfig.ollamaDefaultModel || 'default';
            console.log(`[ApiKeyManager]   Key ${idx + 1}: ${masked} → Model: ${model}`);
        });
        console.log(`[ApiKeyManager] SSH Key: ${this.sshKey ? '설정됨' : '없음'}`);
    }

    /**
     * 🆕 환경변수에서 동적으로 API 키 로드
     * OLLAMA_API_KEY_1, OLLAMA_API_KEY_2, ... OLLAMA_API_KEY_N 순서로 탐색
     * 레거시 지원: OLLAMA_API_KEY_PRIMARY, OLLAMA_API_KEY_SECONDARY
     */
    private loadKeysFromEnv(): string[] {
        const keys: string[] = [];

        // 새로운 형식: OLLAMA_API_KEY_1, _2, _3, ... (무제한)
        let index = 1;
        while (true) {
            const key = process.env[`OLLAMA_API_KEY_${index}`];
            if (key && key.trim() !== '') {
                keys.push(key.trim());
                index++;
            } else {
                break;
            }
        }

        // 레거시 형식 지원 (새 형식에 키가 없을 때만)
        if (keys.length === 0) {
            const cfg = getConfig();
            const primary = cfg.ollamaApiKeyPrimary || cfg.ollamaApiKey;
            const secondary = cfg.ollamaApiKeySecondary;

            if (primary && primary.trim() !== '') keys.push(primary.trim());
            if (secondary && secondary.trim() !== '') keys.push(secondary.trim());
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
     * 다음 키로 순환
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

// 싱글톤 인스턴스
let apiKeyManager: ApiKeyManager | null = null;

export function getApiKeyManager(): ApiKeyManager {
    if (!apiKeyManager) {
        apiKeyManager = new ApiKeyManager();
    }
    return apiKeyManager;
}

export function resetApiKeyManager(): void {
    apiKeyManager = null;
}
