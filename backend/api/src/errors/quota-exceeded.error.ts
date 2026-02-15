/**
 * ============================================================
 * QuotaExceededError - API 할당량 초과 에러
 * ============================================================
 *
 * 시간별(hourly) 또는 주간(weekly) API 요청 할당량이 초과되었을 때 발생합니다.
 * HTTP 429 Too Many Requests 응답으로 클라이언트에 전달되며,
 * 사용량(used), 한도(limit), 재시도 대기 시간(retryAfterSeconds) 정보를 포함합니다.
 *
 * @module errors/quota-exceeded.error
 * @throws HTTP 429 Too Many Requests
 * @see api-usage-tracker.ts - 사용량 추적 및 할당량 검사
 */
export class QuotaExceededError extends Error {
    public readonly quotaType: 'hourly' | 'weekly' | 'both';
    public readonly used: number;
    public readonly limit: number;
    public readonly retryAfterSeconds: number;

    constructor(quotaType: 'hourly' | 'weekly' | 'both', used: number, limit: number) {
        const message = `API quota exceeded (${quotaType}): ${used}/${limit} requests used`;
        super(message);
        this.name = 'QuotaExceededError';
        this.quotaType = quotaType;
        this.used = used;
        this.limit = limit;
        // Hourly quota resets faster
        this.retryAfterSeconds = quotaType === 'hourly' ? 3600 : 86400;
    }
}
