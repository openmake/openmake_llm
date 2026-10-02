/**
 * mapOpenAIError — 잔액 부족 응답 분류 (2026-09-04 B.AI 실측)
 *
 * B.AI 는 402 가 아니라 400(insufficient_user_quota)·403("Deposit required") 로 잔액 부족을 알린다.
 * 종전엔 각각 UPSTREAM_ERROR·INVALID_API_KEY 가 되어 폴백 배지가 "업스트림 오류"/"인증 오류"로 오안내됐다.
 */
import { mapOpenAIError } from '../openai-compat-provider';

function httpErr(status: number, message: string): Error & { status: number } {
    return Object.assign(new Error(message), { status });
}

describe('mapOpenAIError — 잔액 부족 분류', () => {
    it('400 insufficient_user_quota (B.AI) → INSUFFICIENT_CREDIT', () => {
        const e = mapOpenAIError(httpErr(400, 'litellm.BadRequestError: OpenAIException - credit insufficient balance: balance=0 required=18'));
        expect(e.code).toBe('INSUFFICIENT_CREDIT');
    });

    it('403 "Deposit required" (B.AI premium) → INSUFFICIENT_CREDIT (인증 오류 아님)', () => {
        const e = mapOpenAIError(httpErr(403, 'Access restricted. Deposit required to unlock premium models.'));
        expect(e.code).toBe('INSUFFICIENT_CREDIT');
    });

    it('402 → INSUFFICIENT_CREDIT (종전 동작 유지)', () => {
        expect(mapOpenAIError(httpErr(402, 'Payment required')).code).toBe('INSUFFICIENT_CREDIT');
    });

    it('일반 400 은 여전히 UPSTREAM_ERROR', () => {
        expect(mapOpenAIError(httpErr(400, 'The request is invalid: unsupported parameter')).code).toBe('UPSTREAM_ERROR');
    });

    it('403 "only available on agentic harnesses" (OpenRouter inkling) → MODEL_ACCESS_RESTRICTED', () => {
        const e = mapOpenAIError(httpErr(403, 'thinkingmachines/inkling:free is only available on agentic harnesses. Try plugging it into a coding agent or productivity tool.'));
        expect(e.code).toBe('MODEL_ACCESS_RESTRICTED');
    });

    it('403 학습 동의 필요 (Logfare premium) → MODEL_ACCESS_RESTRICTED (인증 오류 아님)', () => {
        const e = mapOpenAIError(httpErr(403, "Model 'qwen-3.8-27b' is a premium model that requires model-training opt-in. The API key you sent authenticates as account 'x', which is NOT opted in."));
        expect(e.code).toBe('MODEL_ACCESS_RESTRICTED');
    });

    it('403 구독 문구는 여전히 SUBSCRIPTION_REQUIRED, 일반 403 은 INVALID_API_KEY', () => {
        expect(mapOpenAIError(httpErr(403, 'this model requires a subscription, upgrade for access')).code).toBe('SUBSCRIPTION_REQUIRED');
        expect(mapOpenAIError(httpErr(403, 'forbidden')).code).toBe('INVALID_API_KEY');
    });
});

describe('mapOpenAIError — 분류되지 않은 400', () => {
    it('요청 자체를 거절한 400 은 status 400 을 지닌다 — 폴백 판정이 "재시도 무의미"로 보게', () => {
        const e = mapOpenAIError(httpErr(400, "Unsupported parameter: 'temperature'"));
        expect(e.code).toBe('UPSTREAM_ERROR');
        expect((e as { status?: number }).status).toBe(400);
    });
    it('잔액 부족·5xx·연결 오류에는 status 를 붙이지 않는다(종전 폴백 규약 유지)', () => {
        expect((mapOpenAIError(httpErr(400, 'credit insufficient balance')) as { status?: number }).status).toBeUndefined();
        expect((mapOpenAIError(httpErr(503, 'overloaded')) as { status?: number }).status).toBeUndefined();
        expect((mapOpenAIError(new Error('ECONNRESET')) as { status?: number }).status).toBeUndefined();
    });
});
