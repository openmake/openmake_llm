/**
 * 도구 호출 인자 영속 준비 — 마스킹 + 크기 캡 (091).
 *
 * 스텝에는 tool_name 만 남아 있어 "어떤 인자로 호출해 실패했는가"를 사후에 복기할 수 없었다.
 * 인자를 그대로 저장하면 두 가지가 문제라 이 모듈을 거친다:
 *   ① 사용자 BYOK·토큰이 MCP 도구 인자로 흘러들 수 있음 → 민감 키 재귀 마스킹
 *   ② write 계열 도구는 파일 본문 전체를 인자로 받음 → 직렬화 길이 캡
 *
 * @module services/agent-task/tool-args
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';

/** 값을 가려야 하는 키 이름 조각 — error-handler 의 sanitizeForLog 와 같은 기준. */
const SENSITIVE_KEY_PATTERNS = [
    'password', 'token', 'api_key', 'apikey', 'secret', 'key',
    'authorization', 'auth', 'credential', 'cookie', 'session',
] as const;

const REDACTED = '[REDACTED]';
/** 재귀 깊이 상한 — 순환/과대 중첩 방어. 초과 구간은 표식으로 대체. */
const MAX_DEPTH = 6;
/** 배열 원소 상한 — 긴 배열은 앞부분만 남긴다(대표성 유지). */
const MAX_ARRAY_ITEMS = 20;

function isSensitiveKey(key: string): boolean {
    const lk = key.toLowerCase();
    return SENSITIVE_KEY_PATTERNS.some((p) => lk.includes(p));
}

function maskValue(value: unknown, depth: number): unknown {
    if (depth > MAX_DEPTH) return '[DEPTH_LIMIT]';
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        const head = value.slice(0, MAX_ARRAY_ITEMS).map((v) => maskValue(v, depth + 1));
        return value.length > MAX_ARRAY_ITEMS
            ? [...head, `[+${value.length - MAX_ARRAY_ITEMS} more]`]
            : head;
    }
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) =>
            isSensitiveKey(k) ? [k, REDACTED] : [k, maskValue(v, depth + 1)]),
    );
}

/**
 * 도구 인자를 영속 가능한 형태로 정규화한다. 절대 throw 하지 않는다(관측이 실행을 막지 않음).
 *
 * @returns 저장할 값. 비활성이거나 인자가 비었으면 undefined(= 컬럼 NULL).
 *          캡을 넘으면 `{ _truncated: true, _chars, preview }` 형태로 대체한다.
 */
export function prepareToolArgs(args: unknown): unknown {
    if (!AGENT_TASK_LIMITS.TOOL_ARGS_PERSIST_ENABLED) return undefined;
    if (args === null || args === undefined) return undefined;
    try {
        if (typeof args === 'object' && !Array.isArray(args) && Object.keys(args).length === 0) return undefined;
        const masked = maskValue(args, 0);
        const json = JSON.stringify(masked) ?? '';
        const cap = AGENT_TASK_LIMITS.TOOL_ARGS_MAX_CHARS;
        if (json.length <= cap) return masked;
        return { _truncated: true, _chars: json.length, preview: json.slice(0, cap) };
    } catch {
        // 순환 참조·직렬화 불가 값 — 관측을 포기하고 실행은 계속한다.
        return undefined;
    }
}
