/**
 * ============================================================
 * KeyExhaustionError - API 키 소진 에러
 * ============================================================
 *
 * 모든 API 키가 Rate Limit에 의해 소진(exhausted)되었을 때 발생합니다.
 * 다음 키 사용 가능 시점(resetTime), 재시도 대기 시간(retryAfterSeconds),
 * 전체 키 수 및 쿨다운 중인 키 수 정보를 포함합니다.
 *
 * @module errors/key-exhaustion.error
 * @throws HTTP 503 또는 WebSocket error 메시지로 클라이언트에 전달
 * @see api-key-manager.ts - 키 로테이션 및 쿨다운 관리
 */
export class KeyExhaustionError extends Error {
    /** Timestamp when the next key will be available (earliest reset time) */
    public readonly resetTime: Date;
    /** Seconds until the next key is available */
    public readonly retryAfterSeconds: number;
    /** Total number of API keys configured */
    public readonly totalKeys: number;
    /** Number of keys currently in cooldown */
    public readonly keysInCooldown: number;

    constructor(resetTime: Date, totalKeys: number, keysInCooldown: number) {
        const retryAfterSeconds = Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
        const message = `All API keys exhausted (${keysInCooldown}/${totalKeys} in cooldown). Retry after ${retryAfterSeconds}s`;
        super(message);
        this.name = 'KeyExhaustionError';
        this.resetTime = resetTime;
        this.retryAfterSeconds = retryAfterSeconds;
        this.totalKeys = totalKeys;
        this.keysInCooldown = keysInCooldown;
    }

    /**
     * Get a user-friendly message for display
     */
    getDisplayMessage(language: 'ko' | 'en' = 'ko'): string {
        const minutes = Math.ceil(this.retryAfterSeconds / 60);
        
        if (language === 'ko') {
            return `⚠️ 모든 API 키가 일시적으로 사용 불가능합니다.\n` +
                   `약 ${minutes}분 후에 다시 시도해주세요.\n` +
                   `(${this.keysInCooldown}/${this.totalKeys}개 키 쿨다운 중)`;
        } else {
            return `⚠️ All API keys are temporarily unavailable.\n` +
                   `Please try again in about ${minutes} minutes.\n` +
                   `(${this.keysInCooldown}/${this.totalKeys} keys in cooldown)`;
        }
    }
}
