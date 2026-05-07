/**
 * ============================================================
 * Evaluation Types — 회귀 검출 평가 파이프라인 (PoC)
 * ============================================================
 *
 * 골든셋 기반 라우팅 정확도 측정용 타입 정의.
 * Phase 3 LLM 평가 파이프라인의 일부.
 *
 * @module evaluation/types
 */

/** 평가 카테고리 — 측정 영역 */
export type EvaluationCategory =
    | 'routing-accuracy'        // 에이전트 라우팅 정확도
    | 'topic-classification'    // 토픽 분류 정확도
    | 'response-pattern';       // 응답 패턴 검증 (substring 포함/제외)

/** 골든셋 단일 케이스 */
export interface GoldenCase {
    /** 고유 ID (예: "routing-001") */
    id: string;
    /** 평가 카테고리 */
    category: EvaluationCategory;
    /** 사용자 쿼리 */
    query: string;
    /** 예상 에이전트 ID — 단일 정답 (legacy, 하위 호환) */
    expectedAgentId?: string;
    /** 예상 에이전트 ID 허용 목록 — 다중 정답 (예: software-engineer | backend-developer 둘 다 OK) */
    expectedAgentIds?: string[];
    /** 예상 에이전트 카테고리 (routing-accuracy 카테고리에서 사용 가능) */
    expectedCategory?: string;
    /** 예상 카테고리 허용 목록 — 다중 정답 */
    expectedCategories?: string[];
    /** 응답에 반드시 포함되어야 할 substring 목록 (response-pattern용) */
    mustContain?: string[];
    /** 응답에 절대 포함되어서는 안 될 substring 목록 (response-pattern용) */
    mustNotContain?: string[];
    /** 쿼리 언어 (다국어 분석용) */
    language?: string;
    /** 추가 메타데이터 (디버그/필터용) */
    tags?: string[];
}

/** 평가 데이터셋 (메타데이터 + 케이스 모음) */
export interface GoldenDataset {
    /** 데이터셋 버전 (회귀 비교용) */
    version: string;
    /** 데이터셋 설명 */
    description: string;
    /** 케이스 목록 */
    cases: GoldenCase[];
}

/** 단일 케이스 평가 결과 */
export interface CaseResult {
    /** 케이스 ID */
    caseId: string;
    /** 카테고리 */
    category: EvaluationCategory;
    /** 통과 여부 */
    passed: boolean;
    /** 실패 원인 (passed=false일 때) */
    failureReason?: string;
    /** 실제 결과 (디버그용) */
    actual?: Record<string, unknown>;
    /** 예상 결과 (디버그용) */
    expected?: Record<string, unknown>;
    /** 실행 소요 시간 (ms) */
    durationMs: number;
}

/** 데이터셋 전체 평가 요약 */
export interface EvaluationSummary {
    /** 데이터셋 버전 */
    datasetVersion: string;
    /** 평가 시작 시각 (ISO 8601) */
    startedAt: string;
    /** 평가 종료 시각 (ISO 8601) */
    completedAt: string;
    /** 총 케이스 수 */
    totalCases: number;
    /** 통과 케이스 수 */
    passedCases: number;
    /** 실패 케이스 수 */
    failedCases: number;
    /** 통과율 (0.0~1.0) */
    passRate: number;
    /** 카테고리별 통과율 */
    passRateByCategory: Partial<Record<EvaluationCategory, { total: number; passed: number; rate: number }>>;
    /** 평균 케이스 실행 시간 (ms) */
    avgDurationMs: number;
    /** 개별 케이스 결과 */
    results: CaseResult[];
}
