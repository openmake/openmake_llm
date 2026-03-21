/**
 * ============================================================
 * LLM 파라미터 중앙 관리
 * ============================================================
 * temperature, confidence 제수(divisor) 등 LLM 호출 시
 * 사용하는 수치 파라미터를 정의합니다.
 * 환경변수로 오버라이드할 수 있습니다.
 *
 * @module config/llm-parameters
 */

// ============================================
// Temperature 프리셋
// ============================================

/**
 * 용도별 LLM temperature 값
 * 각 서비스/라우트에서 참조
 */
export const LLM_TEMPERATURES = {
    /** 메모리 추출 (ChatService) */
    MEMORY_EXTRACTION: Number(process.env.LLM_TEMP_MEMORY_EXTRACTION) || 0.1,
    /** 문서 요약 (documents.routes) */
    DOCUMENT_SUMMARY: Number(process.env.LLM_TEMP_DOCUMENT_SUMMARY) || 0.1,
    /** 문서 Q&A (documents.routes) */
    DOCUMENT_QA: Number(process.env.LLM_TEMP_DOCUMENT_QA) || 0.1,
    /** 웹 검색 사실 검증 (web-search.routes) */
    WEB_SEARCH: Number(process.env.LLM_TEMP_WEB_SEARCH) || 0.3,
    /** 리서치 주제 분해 (DeepResearchService) */
    RESEARCH_PLAN: Number(process.env.LLM_TEMP_RESEARCH_PLAN) || 0.3,
    /** 리서치 청크 합성 (DeepResearchService) */
    RESEARCH_SYNTHESIS: Number(process.env.LLM_TEMP_RESEARCH_SYNTHESIS) || 0.35,
    /** 리서치 최종 보고서 / 병합 (DeepResearchService) */
    RESEARCH_REPORT: Number(process.env.LLM_TEMP_RESEARCH_REPORT) || 0.4,
    /** 리서치 사실 확인 (DeepResearchService) */
    RESEARCH_FACT_CHECK: Number(process.env.LLM_TEMP_RESEARCH_FACT_CHECK) || 0.1,
    /** Discussion 이미지 분석 (discussion-strategy) */
    DISCUSSION: Number(process.env.LLM_TEMP_DISCUSSION) || 0.2,
    /** 에이전트 도구 호출 OCR (agent-loop-strategy) */
    AGENT_TOOL_CALL: Number(process.env.LLM_TEMP_AGENT_TOOL_CALL) || 0.1,
    /** 에이전트 이미지 분석 응답 (agent-loop-strategy) */
    AGENT_RESPONSE: Number(process.env.LLM_TEMP_AGENT_RESPONSE) || 0.3,
    /** format 지정 시 strict 모드 temperature */
    FORMAT_STRICT: 0,
    /** A2A 라우팅 temperature */
    A2A_ROUTING: 0,
    /** A2A 합성기 응답 (a2a-strategy) */
    A2A_RESPONSE: Number(process.env.LLM_TEMP_A2A_RESPONSE) || 0.3,
} as const;

// ============================================
// 신뢰도 제수(Divisor)
// ============================================

/**
 * 신뢰도 계산 시 정규화에 사용하는 제수
 * confidence = min(score / divisor, 1.0)
 */
export const CONFIDENCE_DIVISORS = {
    /** 쿼리 분류기 (query-classifier.ts) */
    QUERY_CLASSIFIER: Number(process.env.CONFIDENCE_DIV_QUERY) || 4,
    /** 키워드 라우터 (keyword-router.ts) */
    KEYWORD_ROUTER: Number(process.env.CONFIDENCE_DIV_KEYWORD) || 10,
    /** 토픽 분석기 (topic-analyzer.ts) */
    TOPIC_ANALYZER: Number(process.env.CONFIDENCE_DIV_TOPIC) || 3,
} as const;
