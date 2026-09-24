/**
 * 수집 작업 재시도 판정 — claim 이 attempts 를 이미 +1 해 돌려주므로 다시 더하지 않는다(2026-09-24 코드 리뷰: 설정보다 1회 적게 실행되던 결함).
 */
import { retryPlan } from '../jobs/worker';
import { KNOWLEDGE_RUNTIME } from '../constants';

describe('retryPlan', () => {
    it('jobMaxAttempts=3 이면 1·2번째 실패는 재시도, 3번째 실패에서 최종 실패', () => {
        expect(retryPlan(1, 3).final).toBe(false);
        expect(retryPlan(2, 3).final).toBe(false);
        expect(retryPlan(3, 3).final).toBe(true);
    });

    it('첫 재시도 백오프는 기준값(배로 늘리지 않는다), 이후 지수 증가·상한', () => {
        expect(retryPlan(1, 5).backoffMs).toBe(KNOWLEDGE_RUNTIME.JOB_BACKOFF_BASE_MS);
        expect(retryPlan(2, 5).backoffMs).toBe(Math.min(KNOWLEDGE_RUNTIME.JOB_BACKOFF_MAX_MS, KNOWLEDGE_RUNTIME.JOB_BACKOFF_BASE_MS * 2));
        expect(retryPlan(60, 99).backoffMs).toBe(KNOWLEDGE_RUNTIME.JOB_BACKOFF_MAX_MS);
    });
});
