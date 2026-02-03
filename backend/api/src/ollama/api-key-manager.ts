/**
 * API Key Manager with Automatic Multi-Key Rotation
 * 🆕 무제한 API 키 자동 순환 로직 (OLLAMA_API_KEY_1, _2, _3, ... _N)
 */

export interface ApiKeyConfig {
    keys: string[];
    sshKey?: string;
}

export class ApiKeyManager {
    private keys: string[] = [];
    private currentKeyIndex = 0;
    private sshKey: string | undefined;
    private failureCount = 0;
    private readonly maxFailures = 2;  // 더 빠른 스와핑
    private lastFailoverTime: Date | null = null;
    private keyFailures: Map<number, { count: number; lastFail: Date }> = new Map();

    constructor(config?: Partial<ApiKeyConfig>) {
        // 🆕 환경변수에서 동적으로 모든 API 키 로드 (OLLAMA_API_KEY_1, _2, _3, ... _N)
        if (config?.keys && config.keys.length > 0) {
            this.keys = config.keys.filter(k => k && k.trim() !== '');
        } else {
            this.keys = this.loadKeysFromEnv();
        }

        this.sshKey = config?.sshKey || process.env.OLLAMA_SSH_KEY;

        console.log(`[ApiKeyManager] 🔑 초기화됨 - ${this.keys.length}개 API 키 등록`);
        this.keys.forEach((key, idx) => {
            const masked = key.substring(0, 8) + '...' + key.substring(key.length - 4);
            console.log(`[ApiKeyManager]   Key ${idx + 1}: ${masked}`);
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
            const primary = process.env.OLLAMA_API_KEY_PRIMARY || process.env.OLLAMA_API_KEY;
            const secondary = process.env.OLLAMA_API_KEY_SECONDARY;

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
    reportFailure(error?: any): boolean {
        this.failureCount++;
        const errorCode = error?.response?.status || error?.code || 'unknown';

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
        console.log(`[ApiKeyManager] 🔄 키 전환: Key ${previousIndex + 1} (${previousMasked}) → Key ${nextIndex + 1} (${newMasked})`);

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
     * 현재 상태 조회
     */
    getStatus(): {
        activeKeyIndex: number;
        totalKeys: number;
        failures: number;
        lastFailover: Date | null;
        keyStatuses: { index: number; failCount: number; lastFail: Date | null }[];
    } {
        const keyStatuses = this.keys.map((_, idx) => {
            const failure = this.keyFailures.get(idx);
            return {
                index: idx,
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
