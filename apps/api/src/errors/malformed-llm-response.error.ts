/**
 * MalformedLLMResponseError — upstream 이 200 으로 답했지만 OpenAI 호환 본문(`choices`)이 아닐 때.
 * HTTP 502(잘못된 upstream 응답) — `isTransientLLMError` 가 재시도 대상으로 본다.
 * 종전엔 `r.choices[0]` 이 TypeError 로 터져 에이전트 작업이 재시도 없이 실패했다(2026-09-25, hasa:qwen3-coder 3/9).
 * @module errors/malformed-llm-response.error
 */
export class MalformedLLMResponseError extends Error {
    public readonly status = 502;
    constructor(model: string, detail: string) {
        super(`LLM 응답에 choices 가 없습니다 (model=${model})${detail ? `: ${detail}` : ''}`);
        this.name = 'MalformedLLMResponseError';
    }
}
