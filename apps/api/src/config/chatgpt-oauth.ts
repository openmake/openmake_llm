/**
 * @module config/chatgpt-oauth
 * @description ChatGPT OAuth (Codex device flow) 설정 — L2 config + env override
 *
 * ChatGPT Plus/Pro 구독 계정으로 Codex 지원 GPT 모델을 사용하는 OAuth 통합.
 * 공식 Codex CLI 의 OAuth 클라이언트를 차용하는 방식으로,
 * openai-oauth(EvanZhouDev) 와 동일 계열 기법이다.
 *
 * ⚠️ 비공식 endpoint — OpenAI 가 언제든 변경/차단할 수 있다. 값이 바뀌면
 * env 로 무중단 오버라이드 가능하도록 전부 외부화한다.
 *
 * @see https://github.com/EvanZhouDev/openai-oauth (packages/core)
 */

/** 카탈로그 provider id — fullId prefix ('chatgpt:gpt-5.x') */
export const CHATGPT_PROVIDER_ID = 'chatgpt';

export const CHATGPT_OAUTH = {
    /** Codex CLI 공식 OAuth 클라이언트 ID (공개 값 — PKCE public client) */
    CLIENT_ID: process.env.CHATGPT_OAUTH_CLIENT_ID || 'app_EMoamEEZ73f0CkXaXp7hrann',

    /** OAuth 발급자 (authorize/token/deviceauth 공통 origin) */
    ISSUER: process.env.CHATGPT_OAUTH_ISSUER || 'https://auth.openai.com',

    /** Codex 백엔드 base URL — Responses API 전용 upstream */
    CODEX_BASE_URL:
        process.env.CHATGPT_CODEX_BASE_URL || 'https://chatgpt.com/backend-api/codex',

    /** 디바이스 코드 폴링 기본 간격 (초) — usercode 응답의 interval 이 우선 */
    DEVICE_POLL_INTERVAL_SEC: parseInt(
        process.env.CHATGPT_OAUTH_DEVICE_POLL_INTERVAL_SEC || '5', 10,
    ),

    /** access token 만료 전 이 여유(ms) 이내면 선제 refresh */
    REFRESH_MARGIN_MS: parseInt(
        process.env.CHATGPT_OAUTH_REFRESH_MARGIN_MS || '60000', 10,
    ),

    /** refresh 실패 등으로 expires 를 모를 때 가정하는 access token 수명 (초) */
    DEFAULT_ACCESS_TOKEN_TTL_SEC: parseInt(
        process.env.CHATGPT_OAUTH_ACCESS_TTL_SEC || '3600', 10,
    ),
} as const;

/** 사용자가 코드를 입력할 검증 페이지 URL */
export function chatgptDeviceVerifyUrl(): string {
    return `${CHATGPT_OAUTH.ISSUER}/codex/device`;
}
