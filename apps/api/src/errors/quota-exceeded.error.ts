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
 * @see llm/user-quota.ts - 사용량 추적 및 할당량 검사(이 에러의 유일한 throw 처)
 */
import { QUOTA_RETRY_AFTER } from '../config/timeouts';

/** 'org_monthly' = 조직 월 예산(127) — 멤버 합산 사용량이 organizations.monthly_token_budget 을 넘음. */
export type QuotaType = 'hourly' | 'weekly' | 'both' | 'org_monthly' | 'cost_monthly' | 'org_cost_monthly';

export class QuotaExceededError extends Error {
    public readonly quotaType: QuotaType;
    public readonly used: number;
    public readonly limit: number;
    public readonly retryAfterSeconds: number;
    /** 초과 승인 요청(135)이 생성·존재하면 그 id — 프론트가 '승인 대기 중' 을 안내한다 */
    public approvalRequestId?: string;

    constructor(quotaType: QuotaType, used: number, limit: number) {
        // 단위는 **토큰** — user-quota.ts 가 llmHourlyTokenLimit/llmWeeklyTokenLimit(토큰 수)로
        // 검사한다. 예전 문구가 "requests used" 라 요청 수로 읽혀, 업스트림 프로바이더의
        // 요청 쿼터 초과로 오진하기 쉬웠다.
        const message = `API quota exceeded (${quotaType}): ${used}/${limit} tokens used`;
        super(message);
        this.name = 'QuotaExceededError';
        this.quotaType = quotaType;
        this.used = used;
        this.limit = limit;
        // Hourly quota resets faster
        this.retryAfterSeconds = quotaType === 'hourly' ? QUOTA_RETRY_AFTER.HOURLY_SECONDS : QUOTA_RETRY_AFTER.DAILY_SECONDS;
    }
}
