/**
 * 도구 호출 인자 JSON 파싱 — 스트림·비스트림 경로 공용(stream-parser 에서 분리 — 파일 크기 가드).
 *
 * @module llm/tool-call-args
 */
import { createLogger } from '../utils/logger';

const log = createLogger('StreamParser');

/**
 * 인자 문자열을 객체로 읽는다. 절단·불량이면 {} 로 강등하고 invalid 로 표시한다 — 관측 로그는 반드시 남긴다
 * (silent 강등 시 "모델이 인자를 안 보낸 것"과 구분 불가 — 2026-07-17 web_search 사건).
 * 빈 문자열은 인자 없는 호출이다(불량 아님).
 */
export function parseToolCallArguments(raw: unknown, toolName: string): { args: Record<string, unknown>; invalid: boolean } {
    const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
    if (!text.trim()) return { args: {}, invalid: false };
    try {
        return { args: JSON.parse(text) as Record<string, unknown>, invalid: false };
    } catch {
        log.warn(`tool call 인자 JSON 파싱 실패 — {} 로 강등: tool=${toolName} raw=${text.slice(0, 200)}`);
        return { args: {}, invalid: true };
    }
}
