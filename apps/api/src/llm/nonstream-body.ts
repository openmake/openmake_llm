/**
 * 비스트림 응답 본문 정규화 (2026-09-26).
 * OpenAI SDK 는 응답 Content-Type 이 JSON 이 아니면 본문을 **문자열**로 돌려준다. hasa 직결 응답이 이렇게 와서(본문은 정상
 * chat.completion JSON) `choices` 가 없는 것으로 판정돼 Planner·사고 요약이 전부 실패했다(2026-09-26, gpt-oss-120b·
 * nemotron-super-120b·kanana-2-30b). 문자열이면 한 번 더 파싱하고, 그래도 `choices` 가 없을 때만 재시도 가능한 502 로 던진다.
 * @module llm/nonstream-body
 */
import { TRUNCATION } from '../config/runtime-limits';
import { MalformedLLMResponseError } from '../errors/malformed-llm-response.error';
import { createLogger } from '../utils/logger';

const log = createLogger('StreamParser');

export function coerceChatCompletion<T extends { choices?: unknown }>(response: unknown, model: string): T & { error?: unknown } {
    let r = response as (T & { error?: unknown }) | string | null | undefined;
    if (typeof r === 'string') {
        try {
            const parsed: unknown = JSON.parse(r);
            if (parsed && typeof parsed === 'object') {
                log.warn(`비스트림 응답이 문자열로 왔습니다(Content-Type 이 JSON 아님) — 본문을 JSON 으로 파싱해 사용 (model=${model})`);
                r = parsed as T & { error?: unknown };
            }
        } catch { /* JSON 이 아닌 본문 — 아래에서 502 */ }
    }
    if (typeof r !== 'object' || r === null || !Array.isArray(r.choices)) {
        const body = typeof r === 'object' && r !== null ? (r.error ?? r) : r;
        throw new MalformedLLMResponseError(model, JSON.stringify(body ?? null).slice(0, TRUNCATION.MALFORMED_LLM_RESPONSE_DETAIL_MAX));
    }
    return r;
}
