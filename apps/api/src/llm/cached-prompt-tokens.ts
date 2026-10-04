/**
 * usage 에서 캐시 적중(cached) 프롬프트 토큰을 읽는다 — provider 마다 자리가 다르다.
 *  - OpenAI·vLLM(chat completions): `prompt_tokens_details.cached_tokens`
 *    (vLLM 은 `--enable-prompt-tokens-details` 로 켜야 낸다)
 *  - OpenAI Responses: `input_tokens_details.cached_tokens`
 *  - Anthropic: `cache_read_input_tokens` (`cache_creation_input_tokens` 는 캐시에 쓴 양이라 적중이 아니다)
 *
 * 서버가 값을 주지 않으면 undefined 를 돌려준다. 0 으로 꾸미지 않는다 — "서버가 안 줌"과 "적중 0"은 다른 사실이다.
 */
function tokenCount(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function cachedOf(details: unknown): number | undefined {
    if (typeof details !== 'object' || details === null) return undefined;
    return tokenCount((details as { cached_tokens?: unknown }).cached_tokens);
}

export function readCachedPromptTokens(usage: unknown): number | undefined {
    if (typeof usage !== 'object' || usage === null) return undefined;
    const u = usage as { prompt_tokens_details?: unknown; input_tokens_details?: unknown; cache_read_input_tokens?: unknown };
    // 두 형식이 함께 오면(LiteLLM 이 옮긴 Anthropic 응답) 같은 값의 두 표기다 — 더하지 않고 앞의 것을 쓴다.
    return cachedOf(u.prompt_tokens_details) ?? cachedOf(u.input_tokens_details) ?? tokenCount(u.cache_read_input_tokens);
}
