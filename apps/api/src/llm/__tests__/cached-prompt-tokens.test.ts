/**
 * usage 에서 캐시 적중(cached) 프롬프트 토큰 읽기 — OpenAI·vLLM / Responses / Anthropic 형식.
 * 서버가 값을 주지 않으면 undefined 다(0 으로 꾸미지 않는다 — "안 줌"과 "적중 0"을 구분).
 */
import { readCachedPromptTokens } from '../cached-prompt-tokens';

describe('readCachedPromptTokens', () => {
    it('OpenAI·vLLM 형식 — prompt_tokens_details.cached_tokens', () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 64 } })).toBe(64);
    });

    it('Responses 형식 — input_tokens_details.cached_tokens', () => {
        expect(readCachedPromptTokens({ input_tokens: 100, input_tokens_details: { cached_tokens: 32 } })).toBe(32);
    });

    it('Anthropic 형식 — cache_read_input_tokens (cache_creation_input_tokens 는 적중이 아니다)', () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100, cache_read_input_tokens: 80, cache_creation_input_tokens: 20 })).toBe(80);
        expect(readCachedPromptTokens({ prompt_tokens: 100, cache_creation_input_tokens: 20 })).toBeUndefined();
    });

    it('서버가 준 0 은 0 으로 둔다(적중 0)', () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 0 } })).toBe(0);
    });

    it('값이 없으면 undefined — 필드 없음·null·숫자가 아닌 값·음수', () => {
        expect(readCachedPromptTokens({ prompt_tokens: 100, completion_tokens: 1 })).toBeUndefined();
        expect(readCachedPromptTokens({ prompt_tokens: 100, prompt_tokens_details: null })).toBeUndefined();
        expect(readCachedPromptTokens({ prompt_tokens_details: { cached_tokens: null } })).toBeUndefined();
        expect(readCachedPromptTokens({ prompt_tokens_details: { cached_tokens: '12' } })).toBeUndefined();
        expect(readCachedPromptTokens({ cache_read_input_tokens: -1 })).toBeUndefined();
        expect(readCachedPromptTokens(undefined)).toBeUndefined();
        expect(readCachedPromptTokens(null)).toBeUndefined();
    });

    it('두 형식이 함께 오면(LiteLLM 의 Anthropic 응답) OpenAI 형식을 쓴다 — 더하지 않는다', () => {
        expect(readCachedPromptTokens({ prompt_tokens_details: { cached_tokens: 80 }, cache_read_input_tokens: 80 })).toBe(80);
    });
});
