/**
 * ============================================================
 * Discussion Engine - 타입 정의
 * ============================================================
 * 
 * 멀티 에이전트 토론 시스템에서 사용되는 모든 인터페이스 정의.
 * 
 * @module agents/discussion-types
 */

// ========================================
// 타입 정의
// ========================================

/**
 * 토론 진행 상황 인터페이스
 * onProgress 콜백으로 전달되어 실시간 진행률을 클라이언트에 알립니다.
 */
export interface DiscussionProgress {
    /** 현재 단계 (선택 -> 토론 -> 검토 -> 합성 -> 완료) */
    phase: 'selecting' | 'discussing' | 'reviewing' | 'synthesizing' | 'complete';
    /** 현재 의견을 제시 중인 에이전트명 */
    currentAgent?: string;
    /** 현재 에이전트 이모지 */
    agentEmoji?: string;
    /** 진행 상황 메시지 (한국어) */
    message: string;
    /** 전체 진행률 (0-100) */
    progress: number;
    /** 현재 라운드 번호 (1-based) */
    roundNumber?: number;
    /** 총 라운드 수 */
    totalRounds?: number;
}

/**
 * 에이전트 의견 인터페이스
 * 각 전문가 에이전트가 생성한 개별 의견을 담습니다.
 */
export interface AgentOpinion {
    /** 에이전트 고유 ID */
    agentId: string;
    /** 에이전트 표시 이름 */
    agentName: string;
    /** 에이전트 이모지 아이콘 */
    agentEmoji: string;
    /** 에이전트가 생성한 의견 텍스트 */
    opinion: string;
    /** 의견의 신뢰도 (0.0-1.0) */
    confidence: number;
    /** 의견 생성 시각 */
    timestamp: Date;
}

/**
 * 토론 결과 인터페이스
 * startDiscussion()의 최종 반환값입니다.
 */
export interface DiscussionResult {
    /** 토론 요약 메시지 (참여 인원, 라운드 수 등) */
    discussionSummary: string;
    /** 최종 합성된 답변 텍스트 */
    finalAnswer: string;
    /** 참여한 에이전트 이름 배열 */
    participants: string[];
    /** 모든 에이전트의 개별 의견 배열 */
    opinions: AgentOpinion[];
    /** 전체 토론 소요 시간 (ms) */
    totalTime: number;
    /** 웹 검색 사실 검증 수행 여부 */
    factChecked?: boolean;
    /** Self-Consistency Score (0.0~1.0, 에이전트 간 합의도) */
    consistencyScore?: number;
    /** 합의 사항 목록 */
    consensusPoints?: string[];
    /** 모순/불일치 사항 목록 */
    conflictPoints?: string[];
}

/**
 * 🆕 컨텍스트 우선순위 설정
 * 토큰 제한 시 우선순위가 높은 컨텍스트가 더 많은 토큰을 할당받음
 */
export interface ContextPriority {
    /** 사용자 메모리 (개인화) - 기본 1순위 */
    userMemory: number;
    /** 대화 히스토리 (맥락 유지) - 기본 2순위 */
    conversationHistory: number;
    /** 문서 컨텍스트 (참조 자료) - 기본 3순위 */
    document: number;
    /** 웹 검색 결과 (사실 검증) - 기본 4순위 */
    webSearch: number;
    /** 이미지 컨텍스트 (시각 자료) - 기본 5순위 */
    image: number;
}

/**
 * 🆕 토큰 제한 설정
 */
export interface TokenLimits {
    /** 전체 컨텍스트 최대 토큰 (기본: 8000) */
    maxTotalTokens: number;
    /** 문서 컨텍스트 최대 토큰 (기본: 3000) */
    maxDocumentTokens: number;
    /** 대화 히스토리 최대 토큰 (기본: 2000) */
    maxHistoryTokens: number;
    /** 웹 검색 최대 토큰 (기본: 1500) */
    maxWebSearchTokens: number;
    /** 사용자 메모리 최대 토큰 (기본: 1000) */
    maxMemoryTokens: number;
    /** 이미지 설명 최대 토큰 (기본: 500) */
    maxImageDescriptionTokens: number;
}

export interface DiscussionConfig {
    maxAgents?: number;
    maxRounds?: number;
    enableCrossReview?: boolean;
    enableFactCheck?: boolean;
    /** 🆕 Deep Thinking 모드 활성화 */
    enableDeepThinking?: boolean;
    userLanguage?: string;
    
    // ========================================
    // 🆕 컨텍스트 엔지니어링 필드
    // ========================================
    /** 업로드된 문서 컨텍스트 (PDF, 이미지 등에서 추출된 텍스트) */
    documentContext?: string;
    /** 대화 히스토리 (이전 대화 맥락 유지) */
    conversationHistory?: Array<{ role: string; content: string }>;
    /** 사용자 메모리 컨텍스트 (장기 기억, 선호도 등) */
    userMemoryContext?: string;
    /** 웹 검색 결과 컨텍스트 */
    webSearchContext?: string;
    
    // ========================================
    // 🆕 이미지 컨텍스트 (비전 모델 지원)
    // ========================================
    /** 이미지 base64 데이터 배열 */
    imageContexts?: string[];
    /** 이미지 분석 결과 (비전 모델이 미리 분석한 텍스트 설명) */
    imageDescriptions?: string[];
    
    // ========================================
    // 🆕 컨텍스트 우선순위 및 토큰 제한
    // ========================================
    /** 컨텍스트 우선순위 설정 */
    contextPriority?: Partial<ContextPriority>;
    /** 토큰 제한 설정 */
    tokenLimits?: Partial<TokenLimits>;
}
