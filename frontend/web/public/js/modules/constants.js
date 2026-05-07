/**
 * ============================================
 * Constants — 프론트엔드 공용 상수
 * ============================================
 * localStorage 키 이름 + 모델 ID 등 하드코딩 방지용 상수.
 * 모든 모듈에서 이 상수를 import하여 사용합니다.
 *
 * @module constants
 */

// ============================================
// localStorage 키 이름
// ============================================

/** 사용자 정보 JSON (로그인 후 저장) */
export const STORAGE_KEY_USER = 'user';

/** JWT 인증 토큰 */
export const STORAGE_KEY_AUTH_TOKEN = 'authToken';

/** 게스트 모드 플래그 ('true'/'false') */
export const STORAGE_KEY_GUEST_MODE = 'guestMode';

/** 게스트 여부 플래그 ('true'/'false') */
export const STORAGE_KEY_IS_GUEST = 'isGuest';

/** 테마 설정 ('dark'/'light'/'system') */
export const STORAGE_KEY_THEME = 'theme';

/** 선택된 LLM 모델 ID */
export const STORAGE_KEY_SELECTED_MODEL = 'selectedModel';

/** MCP 도구 토글 상태 (JSON) */
export const STORAGE_KEY_MCP_SETTINGS = 'mcpSettings';

/** 일반 설정 (JSON) */
export const STORAGE_KEY_GENERAL_SETTINGS = 'generalSettings';

/** 프롬프트 모드 */
export const STORAGE_KEY_PROMPT_MODE = 'promptMode';

/** 에이전트 모드 */
export const STORAGE_KEY_AGENT_MODE = 'agentMode';


// ============================================
// IIFE 모듈용 window 전역 노출
// ============================================
window.STORAGE_KEYS = {
    USER: STORAGE_KEY_USER,
    AUTH_TOKEN: STORAGE_KEY_AUTH_TOKEN,
    GUEST_MODE: STORAGE_KEY_GUEST_MODE,
    IS_GUEST: STORAGE_KEY_IS_GUEST,
    THEME: STORAGE_KEY_THEME,
    SELECTED_MODEL: STORAGE_KEY_SELECTED_MODEL,
    MCP_SETTINGS: STORAGE_KEY_MCP_SETTINGS,
    GENERAL_SETTINGS: STORAGE_KEY_GENERAL_SETTINGS,
    PROMPT_MODE: STORAGE_KEY_PROMPT_MODE,
    AGENT_MODE: STORAGE_KEY_AGENT_MODE
};