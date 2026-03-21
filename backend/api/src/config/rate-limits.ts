/**
 * ============================================================
 * 레이트 리미터 설정 중앙 관리
 * ============================================================
 * 각 API 영역별 레이트 리밋 수치를 정의합니다.
 * 환경변수로 오버라이드할 수 있습니다.
 *
 * @module config/rate-limits
 */

// ============================================
// 공통 윈도우 크기
// ============================================

/** 15분 윈도우 (ms) */
const WINDOW_15M = 15 * 60 * 1000;
/** 1분 윈도우 (ms) */
const WINDOW_1M = 60 * 1000;

// ============================================
// 레이트 리밋 프리셋
// ============================================

/**
 * 일반 API 레이트 리밋
 */
export const RL_GENERAL = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_GENERAL_IP) || 100,
    userLimit: Number(process.env.RL_GENERAL_USER) || 200,
    chatLimit: Number(process.env.RL_GENERAL_CHAT) || 60,
    chatStreamLimit: Number(process.env.RL_GENERAL_CHAT_STREAM) || 40,
    researchLimit: Number(process.env.RL_GENERAL_RESEARCH) || 15,
    uploadLimit: Number(process.env.RL_GENERAL_UPLOAD) || 25,
} as const;

/**
 * 인증 관련 레이트 리밋
 */
export const RL_AUTH = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_AUTH_IP) || 500,
    meLimit: Number(process.env.RL_AUTH_ME) || 200,
    providersLimit: Number(process.env.RL_AUTH_PROVIDERS) || 500,
    loginLimit: Number(process.env.RL_AUTH_LOGIN) || 8,
    registerLimit: Number(process.env.RL_AUTH_REGISTER) || 6,
} as const;

/**
 * 채팅 API 레이트 리밋
 */
export const RL_CHAT = {
    windowMs: WINDOW_1M,
    ipLimit: Number(process.env.RL_CHAT_IP) || 30,
    userLimit: Number(process.env.RL_CHAT_USER) || 45,
    streamLimit: Number(process.env.RL_CHAT_STREAM) || 20,
    chatLimit: Number(process.env.RL_CHAT_CHAT) || 30,
} as const;

/**
 * Research API 레이트 리밋 (LLM 멀티스텝 — 비용 높음)
 */
export const RL_RESEARCH = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_RESEARCH_IP) || 10,
    userLimit: Number(process.env.RL_RESEARCH_USER) || 15,
    researchLimit: Number(process.env.RL_RESEARCH_RESEARCH) || 10,
    deepLimit: Number(process.env.RL_RESEARCH_DEEP) || 6,
} as const;

/**
 * 대용량 업로드 레이트 리밋
 */
export const RL_UPLOAD = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_UPLOAD_IP) || 20,
    userLimit: Number(process.env.RL_UPLOAD_USER) || 30,
    uploadLimit: Number(process.env.RL_UPLOAD_UPLOAD) || 20,
} as const;

/**
 * 웹 검색 레이트 리밋 (외부 API 호출 — 비용 높음)
 */
export const RL_WEB_SEARCH = {
    windowMs: WINDOW_1M,
    ipLimit: Number(process.env.RL_WEB_SEARCH_IP) || 5,
    userLimit: Number(process.env.RL_WEB_SEARCH_USER) || 10,
    searchLimit: Number(process.env.RL_WEB_SEARCH_SEARCH) || 5,
} as const;

/**
 * 메모리 API 레이트 리밋
 */
export const RL_MEMORY = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_MEMORY_IP) || 50,
    userLimit: Number(process.env.RL_MEMORY_USER) || 100,
    createLimit: Number(process.env.RL_MEMORY_CREATE) || 30,
    deleteLimit: Number(process.env.RL_MEMORY_DELETE) || 20,
} as const;

/**
 * MCP 레이트 리밋 (AI 도구 호출 — 비용 높음)
 */
export const RL_MCP = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_MCP_IP) || 20,
    userLimit: Number(process.env.RL_MCP_USER) || 40,
    mcpLimit: Number(process.env.RL_MCP_MCP) || 20,
    toolCallLimit: Number(process.env.RL_MCP_TOOL_CALL) || 10,
} as const;

/**
 * API 키 관리 레이트 리밋
 */
export const RL_API_KEY_MGMT = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_API_KEY_MGMT_IP) || 20,
    userLimit: Number(process.env.RL_API_KEY_MGMT_USER) || 30,
    createLimit: Number(process.env.RL_API_KEY_MGMT_CREATE) || 10,
    deleteLimit: Number(process.env.RL_API_KEY_MGMT_DELETE) || 10,
} as const;

/**
 * 푸시 알림 레이트 리밋
 */
export const RL_PUSH = {
    windowMs: WINDOW_15M,
    ipLimit: Number(process.env.RL_PUSH_IP) || 15,
    userLimit: Number(process.env.RL_PUSH_USER) || 30,
    subscribeLimit: Number(process.env.RL_PUSH_SUBSCRIBE) || 5,
} as const;
