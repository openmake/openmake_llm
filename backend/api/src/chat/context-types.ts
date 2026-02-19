/**
 * ============================================================
 * Context Engineering Types - 4-Pillar Framework 타입 정의
 * ============================================================
 * 
 * context-engineering.ts에서 사용하는 인터페이스/타입 정의를 분리한 모듈입니다.
 * FourPillarPrompt, RoleDefinition, Constraint, OutputFormat,
 * PromptMetadata, RAGContext, RAGDocument 인터페이스를 정의합니다.
 * 
 * @module chat/context-types
 * @see chat/context-engineering - 이 타입들을 사용하는 메인 모듈
 * @see chat/context-xml-helpers - XML 태그 헬퍼 함수
 */

// ============================================================
// 타입 정의
// ============================================================

/**
 * 4-Pillar Framework 프롬프트 구조
 * 
 * 시스템 프롬프트의 4가지 핵심 기둥을 정의합니다.
 * ContextEngineeringBuilder의 build() 메서드가 이 구조를 XML 태깅된 프롬프트로 변환합니다.
 */
export interface FourPillarPrompt {
    /** Pillar 1: 역할 및 페르소나 정의 - AI의 정체성과 전문성 */
    role: RoleDefinition;
    /** Pillar 2: 제약 조건 목록 - 보안, 언어, 형식, 콘텐츠, 행동 규칙 */
    constraints: Constraint[];
    /** Pillar 3: 달성 목표 - AI가 수행해야 할 핵심 과업 */
    goal: string;
    /** Pillar 4: 출력 형식 - 응답의 구조와 포맷 */
    outputFormat: OutputFormat;
}

/**
 * 역할 정의 인터페이스 (Pillar 1)
 * AI의 페르소나, 전문 분야, 행동 특성, 대화 스타일을 정의합니다.
 */
export interface RoleDefinition {
    /** 페르소나 설명 (예: '15년 경력의 시니어 풀스택 개발자') */
    persona: string;
    /** 전문 분야 목록 */
    expertise: string[];
    /** 행동 특성 (예: '에러 핸들링과 엣지 케이스 고려') */
    behavioralTraits?: string[];
    /** 대화 스타일 */
    toneStyle?: 'formal' | 'casual' | 'professional' | 'friendly';
}

/**
 * 제약 조건 인터페이스 (Pillar 2)
 * 우선순위별로 정렬되어 프롬프트에 삽입됩니다.
 * critical 규칙은 절대 위반 불가로 표시됩니다.
 */
export interface Constraint {
    /** 규칙 설명 */
    rule: string;
    /** 우선순위 (critical > high > medium > low) */
    priority: 'critical' | 'high' | 'medium' | 'low';
    /** 규칙 카테고리 */
    category: 'security' | 'language' | 'format' | 'content' | 'behavior';
}

/**
 * 출력 형식 인터페이스 (Pillar 4)
 * AI 응답의 구조와 포맷을 지정합니다.
 */
export interface OutputFormat {
    /** 출력 타입 */
    type: 'json' | 'markdown' | 'plain' | 'code' | 'table' | 'structured';
    /** JSON 출력 시 스키마 정의 */
    schema?: object;
    /** 출력 예시 (Few-shot) */
    examples?: string[];
}

/**
 * 메타데이터 주입을 위한 컨텍스트
 * 프롬프트 시작 부분(Primacy Section)에 삽입되어 AI에 현재 상황을 알려줍니다.
 */
export interface PromptMetadata {
    /** 현재 날짜 (YYYY-MM-DD) */
    currentDate: string;
    /** 지식 기준일 (예: '2024-12') */
    knowledgeCutoff: string;
    /** 세션 ID (대화 추적용) */
    sessionId?: string;
    /** 사용자 언어 설정 */
    userLanguage: 'ko' | 'en' | 'mixed';
    /** 요청 타임스탬프 (ISO 8601) */
    requestTimestamp: string;
    /** 사용 중인 모델명 */
    modelName?: string;
}

/**
 * RAG(Retrieval-Augmented Generation) 컨텍스트 정보
 * 검색된 참조 문서를 프롬프트에 주입하기 위한 구조체입니다.
 */
export interface RAGContext {
    /** 검색된 문서 배열 */
    documents: RAGDocument[];
    /** 검색에 사용된 쿼리 */
    searchQuery: string;
    /** 관련도 임계값 (이 값 이상의 문서만 포함) */
    relevanceThreshold: number;
}

/**
 * RAG 개별 문서 인터페이스
 */
export interface RAGDocument {
    /** 문서 내용 */
    content: string;
    /** 문서 출처 (URL 또는 파일명) */
    source: string;
    /** 문서 날짜 */
    timestamp?: string;
    /** 관련도 점수 (0.0 ~ 1.0) */
    relevanceScore: number;
}
