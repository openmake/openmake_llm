/**
 * ============================================================
 * Model Selector Types - 모델 선택 관련 타입 정의
 * ============================================================
 * 
 * model-selector.ts에서 사용하는 타입 정의를 분리한 모듈입니다.
 * QueryType, QueryClassification, ModelSelection 타입을 정의합니다.
 * 
 * @module chat/model-selector-types
 * @see chat/model-selector - 이 타입들을 사용하는 메인 모듈
 * @see chat/query-classifier - classifyQuery()에서 사용
 */

import { ModelOptions } from '../ollama/types';

// ============================================================
// 질문 유형 정의
// ============================================================

/**
 * 질문 유형 분류 결과 (9가지)
 * classifyQuery()가 사용자 질문을 분석하여 이 중 하나로 분류합니다.
 */
export type QueryType = 
    | 'code'           // 코딩/개발 관련
    | 'analysis'       // 데이터 분석/논리적 추론
    | 'creative'       // 창작/글쓰기/브레인스토밍
    | 'vision'         // 이미지 분석/멀티모달
    | 'korean'         // 한국어 특화
    | 'math'           // 수학/과학 계산
    | 'chat'           // 일반 대화
    | 'document'       // 문서 분석/요약
    | 'translation';   // 번역

/**
 * 질문 분류 결과 인터페이스
 * classifyQuery()의 반환 타입으로, 분류된 유형과 신뢰도 정보를 포함합니다.
 */
export interface QueryClassification {
    /** 분류된 질문 유형 */
    type: QueryType;
    /** 분류 신뢰도 (0.0 ~ 1.0, 높을수록 확실) */
    confidence: number;
    /** 보조 유형 (예: 한국어 비율이 30% 이상이면 'korean') */
    subType?: string;
    /** 매칭된 패턴/키워드 목록 (최대 5개) */
    matchedPatterns: string[];
}

/**
 * 모델 선택 결과 인터페이스
 * selectOptimalModel() 또는 selectModelForProfile()의 반환 타입입니다.
 */
export interface ModelSelection {
    /** 선택된 모델 ID (예: 'gemini-3-flash-preview:cloud') */
    model: string;
    /** 모델에 적용할 옵션 (temperature, top_p 등) */
    options: ModelOptions;
    /** 선택 사유 설명 (한국어) */
    reason: string;
    /** 분류된 질문 유형 */
    queryType: QueryType;
    /** 도구 호출(Tool Calling) 지원 여부 */
    supportsToolCalling: boolean;
    /** 사고(Thinking) 모드 지원 여부 */
    supportsThinking: boolean;
    /** 비전(이미지 분석) 지원 여부 */
    supportsVision: boolean;
}
