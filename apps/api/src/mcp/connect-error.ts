/**
 * MCP 연결 실패 메시지 → 원인 코드 분류 (순수 함수).
 *
 * 규칙표는 `config/mcp-connect-errors.ts`(L2). 여기는 판정만 한다.
 *
 * @module mcp/connect-error
 */
import {
    MCP_CONNECT_ERROR_RULES,
    MCP_CONNECT_ERROR_MAX_CHARS,
    type McpConnectErrorCode,
} from '../config/mcp-connect-errors';

export interface ClassifiedConnectError {
    /** 원인 코드 — 프론트 i18n 키로 쓰인다 */
    code: McpConnectErrorCode;
    /** 원문 메시지(상한 적용) — 코드만으로 부족한 진단을 위해 함께 남긴다 */
    message: string;
}

/**
 * 연결 실패 원인을 분류한다.
 *
 * 어떤 규칙에도 걸리지 않으면 `unknown` — **원문은 그대로 남긴다**. 분류 실패를
 * 빈 값으로 만들면 "원인 없음"과 구분되지 않아, 지금 고치려는 조용한 실패가 그대로 재현된다.
 */
export function classifyConnectError(error: unknown): ClassifiedConnectError {
    const raw = error instanceof Error ? error.message : String(error ?? '');
    // SDK 의 UnauthorizedError 는 메시지가 빈 문자열일 수 있다(authProvider 가 REDIRECT 를 돌려준 경우)
    // — 패턴표로는 못 잡으므로 이름으로 먼저 본다.
    if (error instanceof Error && error.name === 'UnauthorizedError') {
        return { code: 'auth_required', message: (raw.trim() || 'OAuth 로그인이 필요합니다').slice(0, MCP_CONNECT_ERROR_MAX_CHARS) };
    }
    const message = raw.trim().slice(0, MCP_CONNECT_ERROR_MAX_CHARS);
    const rule = MCP_CONNECT_ERROR_RULES.find((r) => r.pattern.test(raw));
    return { code: rule?.code ?? 'unknown', message };
}

/**
 * 영속 저장용 직렬화 — `mcp_server_instances.last_error` 한 컬럼에 코드와 원문을 함께 담는다.
 * 전용 컬럼을 추가하면 마이그레이션이 필요한데, 이 값은 진단용이라 컬럼을 늘릴 이유가 없다.
 */
export function serializeConnectError(e: ClassifiedConnectError): string {
    return `[${e.code}] ${e.message}`;
}

/** 위 직렬화의 역변환 — 접두 코드가 없으면 `unknown` 으로 본다(구 데이터 호환). */
export function parseConnectError(stored: string | null | undefined): ClassifiedConnectError | null {
    if (!stored) return null;
    const m = /^\[([a-z_]+)\]\s?([\s\S]*)$/.exec(stored);
    if (!m) return { code: 'unknown', message: stored.slice(0, MCP_CONNECT_ERROR_MAX_CHARS) };
    return { code: m[1] as McpConnectErrorCode, message: m[2] };
}
