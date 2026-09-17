/**
 * API Key 스코프 정의 (L2) — 키가 접근할 수 있는 기능 축을 좁혀 유출 피해를 제한한다.
 *
 * 와일드카드 `*` 는 전 스코프 허용(기존/UI 발급 키 기본값 — 하위호환). 특정 스코프만 가진
 * 키는 해당 축에서만 동작한다:
 *   - bridge: 로컬 브리지(CLI/데스크톱) 등록 + 로컬 에이전트 작업 REST (WS bridge_hello,
 *             /api/local-bridge, /api/agent-tasks 로컬 실행). 토큰 소진 추론 API 는 불가.
 *   - chat:   OpenAI 호환 추론 API (/api/v1/*) — 토큰을 소비하는 축.
 *   - discord: Discord 봇 프로세스가 기동 시 자기 운영 설정을 받아오는 축
 *             (GET /api/integrations/discord/runtime-config). 추론·브리지는 불가.
 *
 * @module config/api-key-scopes
 */

export const API_KEY_SCOPES = {
    BRIDGE: 'bridge',
    CHAT: 'chat',
    DISCORD: 'discord',
} as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[keyof typeof API_KEY_SCOPES];

/** 발급 시 허용하는 스코프 문자열 화이트리스트 (미지 스코프 거부 — 오타·권한 오해 방지). */
export const ALLOWED_API_KEY_SCOPES: ReadonlySet<string> = new Set([
    '*', API_KEY_SCOPES.BRIDGE, API_KEY_SCOPES.CHAT, API_KEY_SCOPES.DISCORD,
]);

/**
 * 키의 scopes 가 요구 스코프를 만족하는가. `*` 는 전부 허용. scopes 미지정/빈 배열은
 * 기존 키(전권)로 간주해 허용한다(하위호환 — repository 기본값이 ['*'] 라 실질 무영향).
 */
export function apiKeyHasScope(scopes: string[] | undefined | null, required: ApiKeyScope): boolean {
    if (!scopes || scopes.length === 0) return true;
    return scopes.includes('*') || scopes.includes(required);
}
