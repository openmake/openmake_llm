/**
 * QuotaUnavailableError — 쿼터 저장소(KV) 장애로 한도를 판정할 수 없을 때 (QUOTA_FAIL_MODE=closed 전용).
 * HTTP 503. 기본 모드 open 에서는 던지지 않는다(fail-open 유지).
 * @module errors/quota-unavailable.error
 */
export class QuotaUnavailableError extends Error {
    public readonly retryAfterSeconds = 30;
    constructor(cause?: unknown) {
        super('쿼터 저장소를 사용할 수 없어 요청을 처리하지 못했습니다 (QUOTA_FAIL_MODE=closed)');
        this.name = 'QuotaUnavailableError';
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
    }
}
