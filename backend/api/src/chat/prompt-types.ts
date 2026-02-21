/**
 * ============================================================
 * Prompt Types - 시스템 프롬프트 관련 타입 정의
 * ============================================================
 * 
 * prompt.ts에서 사용하는 타입/인터페이스 정의를 분리한 모듈입니다.
 * UserPromptConfig, PromptType, GEMINI_PARAMS 등을 정의합니다.
 * 
 * @module chat/prompt-types
 * @see chat/prompt - 이 타입들을 사용하는 메인 모듈
 * @see chat/prompt-templates - SYSTEM_PROMPTS 상수 및 detectPromptType
 */

// ============================================================
// 사용자 설정 가능 옵션 인터페이스
// ============================================================

/**
 * 사용자 설정 가능 프롬프트 옵션 인터페이스
 * buildSystemPromptWithConfig() 및 getPresetWithUserConfig()에서 사용됩니다.
 */
export interface UserPromptConfig {
    /** 온도 설정 (0.0-1.0, 높을수록 창의적) */
    temperature?: number;
    /** 최대 토큰 수 (기본: 8192) */
    maxTokens?: number;
    /** 지식 기준일 오버라이드 */
    knowledgeCutoff?: string;
    /** Thinking 모드 강제 활성화/비활성화 */
    enableThinking?: boolean;
    /** 커스텀 시스템 프롬프트 접두사 (프롬프트 맨 앞에 추가) */
    customPrefix?: string;
    /** 커스텀 시스템 프롬프트 접미사 (프롬프트 맨 뒤에 추가) */
    customSuffix?: string;
}
