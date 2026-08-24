/**
 * MCP 연결 실패 원인 분류표 (L2 config).
 *
 * 배경 — 원격 MCP 서버(streamable-http/sse)가 OAuth 를 요구하면 연결이 401 로 실패하는데,
 * 실패한 client 는 풀에 등록되지 않아 목록 API 가 `connectionError: null` 을 돌려주고
 * 화면에는 그냥 "연결 안 됨"으로만 보였다. 승인은 성공했는데 도구가 영원히 0개인 상태를
 * 사용자가 알아챌 방법이 없었다 (2026-08-25 라이브 확인: Linear·Asana·Slack·Figma·Atlassian).
 *
 * 여기서는 **패턴 → 코드** 대응만 둔다. 문구는 프론트 i18n(`mcpServers.connectError.*`)이
 * 담당한다 — 백엔드가 한국어 문장을 만들면 다국어에서 다시 갈라진다.
 *
 * @module config/mcp-connect-errors
 */

/** 연결 실패 원인 코드 — 프론트 i18n 키와 1:1 대응한다. */
export type McpConnectErrorCode =
    | 'auth_required'
    | 'not_found'
    | 'unreachable'
    | 'timeout'
    | 'protocol'
    | 'unknown';

/**
 * 판정 규칙 — **위에서부터 먼저 맞는 것**을 채택한다(순서가 곧 우선순위).
 *
 * 원문 메시지는 SDK/fetch/Node 가 만들어 형태가 제각각이라 정규식으로 본다.
 * 401/403 을 최우선에 두는 이유: 인증 문제는 사용자가 할 수 있는 조치가 명확한데
 * "연결 실패"로 뭉뚱그리면 재시도만 반복하게 된다.
 */
export const MCP_CONNECT_ERROR_RULES: readonly { code: McpConnectErrorCode; pattern: RegExp }[] = [
    { code: 'auth_required', pattern: /\b(401|403)\b|unauthorized|forbidden|invalid_token|missing_token|access token|authorization header/i },
    { code: 'not_found', pattern: /\b404\b|not found/i },
    { code: 'timeout', pattern: /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i },
    { code: 'unreachable', pattern: /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|fetch failed|socket hang up/i },
    { code: 'protocol', pattern: /jsonrpc|protocol|invalid.*(response|message)|unexpected token|parse/i },
];

/** 원문 메시지를 화면에 실어 보낼 때의 길이 상한 — 스택/HTML 본문이 통째로 새는 것을 막는다. */
export const MCP_CONNECT_ERROR_MAX_CHARS = 300;
