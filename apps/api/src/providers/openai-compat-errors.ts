/**
 * OpenAI 호환 provider 오류 → ProviderError 분류.
 * openai-compat-provider 에서 분리(파일 크기 가드). 원래 경로에서도 re-export 된다.
 *
 * @module providers/openai-compat-errors
 */
import { ProviderError } from './provider-errors';

/**
 * 402 가 아닌 status 로 오는 잔액 부족 응답 (2026-09-04 B.AI 실측):
 *   400 `{"code":"insufficient_user_quota","message":"credit insufficient balance: balance=0 required=18"}`
 *   403 `"Access restricted. Deposit required to unlock premium models."`
 * 인증 오류·업스트림 오류로 분류하면 사용자에게 "인증 오류"/"업스트림 오류"로 오안내된다.
 */
const INSUFFICIENT_CREDIT_PATTERN = /insufficient[_ ]user[_ ]quota|insufficient balance|deposit required/i;
/**
 * 403 중 키·플랜이 아니라 provider 정책이 호출 경로 자체를 막는 응답 (2026-09-04 OpenRouter 실측):
 *   `thinkingmachines/inkling:free is only available on agentic harnesses. Try plugging it into a coding agent...`
 *   Logfare(2026-09-22): `Model 'qwen-3.8-27b' is a premium model that requires model-training opt-in. ... NOT opted in.`
 *   — 키가 아니라 계정의 학습 동의 설정 문제라 인증 오류로 안내하면 안 된다.
 * 충전·업그레이드로 풀리지 않으므로 SUBSCRIPTION_REQUIRED 와 구분한다.
 */
const MODEL_ACCESS_RESTRICTED_PATTERN = /only available (on|to|for|via)|not available (on|to|for|via) (this|your)|requires model-training opt-in|not opted in/i;

/**
 * 400 중 우리가 보낸 도구 정의(함수 이름 규약)를 provider 가 거절한 응답 (2026-09-04·06 NVIDIA NIM 실측):
 *   `Nvidia_nimException - Validation: Function at index 1 has an invalid name:`
 *   OpenAI 원본: `Invalid 'tools[0].function.name': string does not match pattern`
 * 재시도해도 같고, 로컬 폴백을 타면 사용자가 고른 모델이 조용히 바뀌므로 UPSTREAM_ERROR 와 분리한다.
 */
const INVALID_TOOL_NAME_PATTERN = /(function|tool)[^\n]{0,80}(invalid name|does not match pattern)|invalid '?tools\[/i;

export function mapOpenAIError(err: unknown): ProviderError {
    const message = err instanceof Error ? err.message : String(err);
    if (err && typeof err === 'object' && 'status' in err) {
        const status = (err as { status?: number }).status;
        if ((status === 400 || status === 402 || status === 403) && INSUFFICIENT_CREDIT_PATTERN.test(message)) {
            return new ProviderError('INSUFFICIENT_CREDIT', `잔액 부족: ${message}`, err);
        }
        if (status === 401 || status === 403) {
            // 403 중 구독/플랜 미달 응답은 키 문제가 아님 — 별도 코드로 분기
            // (예: Ollama Cloud "this model requires a subscription, upgrade for access")
            if (status === 403 && MODEL_ACCESS_RESTRICTED_PATTERN.test(message)) {
                return new ProviderError('MODEL_ACCESS_RESTRICTED', `provider 정책상 접근 제한 모델: ${message}`, err);
            }
            if (status === 403 && /subscription|upgrade/i.test(message)) {
                return new ProviderError('SUBSCRIPTION_REQUIRED', `구독 전용 모델: ${message}`, err);
            }
            return new ProviderError('INVALID_API_KEY', `OpenAI 호환 인증 실패: ${message}`, err);
        }
        if (status === 402) {
            // OpenRouter / paid endpoint 의 잔액 부족 — 사용자에게 충전 안내 가능
            return new ProviderError('INSUFFICIENT_CREDIT', `잔액 부족: ${message}`, err);
        }
        if (status === 429) {
            return new ProviderError('QUOTA_EXCEEDED', `OpenAI 호환 할당량 초과: ${message}`, err);
        }
        if (status === 404) {
            return new ProviderError('MODEL_NOT_FOUND', `모델 미발견: ${message}`, err);
        }
        if (status === 400 && INVALID_TOOL_NAME_PATTERN.test(message)) {
            // 코덱이 있어도 신규 provider 가 다른 제약을 걸 수 있다 — 폴백 대상(RETRYABLE_CODES) 밖 코드로 드러낸다.
            return new ProviderError('NOT_SUPPORTED', `provider 가 도구 정의를 거절: ${message}`, err);
        }
        if (status === 400) {
            // 요청 자체를 거절한 응답 — 재시도해도 같다. status 를 남겨 채팅 폴백 판정(external-fallback 의 "400 제외")이
            // 그대로 걸리게 한다. status 없이 감싸면 로컬로 폴백해 사용자가 고른 모델이 이유 없이 바뀐다.
            return Object.assign(new ProviderError('UPSTREAM_ERROR', `OpenAI 호환 호출 실패: ${message}`, err), { status: 400 });
        }
    }
    return new ProviderError('UPSTREAM_ERROR', `OpenAI 호환 호출 실패: ${message}`, err);
}
