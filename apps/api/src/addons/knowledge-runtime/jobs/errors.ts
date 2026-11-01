/**
 * 작업 오류 — 다시 시도해도 결과가 같은 실패(키 없음·키 거절·대상 없음·구 작업 잔재)는 백오프 재시도 없이 즉시 최종 실패로 마감한다.
 * code 는 last_error 앞에 붙는 기계 판독 코드(있으면)다.
 *
 * @module addons/knowledge-runtime/jobs/errors
 */
export class KnowledgeJobPermanentError extends Error {
    constructor(message: string, public readonly code?: string) {
        super(code ? `[${code}] ${message}` : message);
        this.name = 'KnowledgeJobPermanentError';
    }
}
