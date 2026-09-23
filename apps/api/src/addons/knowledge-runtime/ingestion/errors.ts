/**
 * 수집 파이프라인의 기계 판독 실패 코드 — `knowledge_document_versions.failure_code` 에 그대로 들어간다.
 * 사람 문구가 아니라 코드다(웹·iOS 가 코드로 안내 문구를 고른다). 파서·청커·임베딩이 이 오류를 던지면
 * 파이프라인이 코드를 꺼내 버전을 failed 로 마감한다.
 *
 * @module addons/knowledge-runtime/ingestion/errors
 */

/** 실패 코드 표 — 새 실패 종류는 여기 추가한다(인라인 문자열 금지). */
export const FAILURE_CODES = {
    /** 지원하지 않는 MIME·크기 초과 등 수집 전 검증 실패 */
    VALIDATION: 'FAILED_VALIDATION',
    /** PDF 에 텍스트층이 없다(스캔본) — OCR 대상이지 조용히 빈 텍스트로 저장하지 않는다 */
    SCANNED_PDF: 'SCANNED_PDF_UNSUPPORTED',
    /** 디코딩·파싱 실패(깨진 UTF-8·바이너리 등) */
    EXTRACTION: 'FAILED_EXTRACTION',
    /** 청크 생성 실패 */
    CHUNKING: 'FAILED_CHUNKING',
    /** 임베딩 호출·저장 실패 */
    EMBEDDING: 'FAILED_EMBEDDING',
    /** 임베딩 수가 청크 수와 맞지 않는다(부분 성공은 검색 불가) */
    VERIFICATION: 'FAILED_VERIFICATION',
} as const;

export type FailureCode = (typeof FAILURE_CODES)[keyof typeof FAILURE_CODES];

/** 수집 단계 오류 — code 는 기계 판독용, message 는 로그·감사용 */
export class KnowledgeIngestError extends Error {
    constructor(
        public readonly code: FailureCode,
        message: string,
    ) {
        super(message);
        this.name = 'KnowledgeIngestError';
    }
}

/** 임의 오류에서 실패 코드를 뽑는다 — 타입이 있으면 그 코드, 없으면 기본값 */
export function failureCodeOf(err: unknown, fallback: FailureCode): FailureCode {
    return err instanceof KnowledgeIngestError ? err.code : fallback;
}
