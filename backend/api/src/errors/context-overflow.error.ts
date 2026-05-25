/**
 * ContextOverflowError — 입력이 모든 모델의 effective capacity 초과 시 throw.
 *
 * model-pool 의 1M 안전망 3단계 (system 단독 990K+ 초과) 에서 발생.
 * 운영자 알림 대상이 아닌 사용자 입력 검증 에러 — HTTP 400 응답 권장.
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
