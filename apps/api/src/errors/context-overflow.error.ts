/**
 * ContextOverflowError — 입력이 모델 effective capacity(262K) 초과 시 throw.
 *
 * model-pool 안전망 3단계 (truncate·max_tokens 축소로도 못 맞춤) 에서 발생.
 * 사용자 입력 검증 에러 — error-handler 가 HTTP 413 응답 + audit(info, webhook 미발송).
 */
export class ContextOverflowError extends Error {
    public readonly inputTokens: number;
    public readonly limitTokens: number;

    constructor(message: string, inputTokens: number, limitTokens: number) {
        super(message);
        this.name = 'ContextOverflowError';
        this.inputTokens = inputTokens;
        this.limitTokens = limitTokens;
    }
}
