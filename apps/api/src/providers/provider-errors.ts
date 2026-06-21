/**
 * ============================================================
 * Provider Error - LLM Provider 추상화 레이어 에러 타입
 * ============================================================
 *
 * IProvider 구현체(Ollama / Anthropic / OpenAI-compatible 등)가
 * 일관된 형태로 호출 측에 실패 사유를 전달하기 위한 표준 에러 클래스입니다.
 *
 * @module providers/provider-errors
 */

/**
 * Provider 에러 코드 — 호출 측이 분기할 수 있는 표준 사유 집합
 *
 * - `GUEST_NOT_ALLOWED`: 인증 없는 게스트 사용자에게 차단된 기능
 * - `MISSING_API_KEY`: API 키 미설정 (환경변수/DB 모두)
 * - `INVALID_API_KEY`: 키 형식 오류 또는 인증 실패
 * - `QUOTA_EXCEEDED`: 사용량/토큰/요금 한도 초과 (rate limit)
 * - `INSUFFICIENT_CREDIT`: 잔액 부족 (HTTP 402 — OpenRouter 등 paid endpoint)
 * - `MODEL_NOT_FOUND`: provider가 해당 모델을 알지 못함
 * - `NOT_SUPPORTED`: provider가 요청 기능(스트리밍/툴/비전 등)을 지원하지 않음
 * - `UPSTREAM_ERROR`: provider 응답이 5xx 또는 네트워크 실패
 * - `INVALID_MODEL_ID`: 'provider:model' fullId 형식 오류
 */
export type ProviderErrorCode =
    | 'GUEST_NOT_ALLOWED'
    | 'MISSING_API_KEY'
    | 'INVALID_API_KEY'
    | 'QUOTA_EXCEEDED'
    | 'INSUFFICIENT_CREDIT'
    | 'MODEL_NOT_FOUND'
    | 'NOT_SUPPORTED'
    | 'UPSTREAM_ERROR'
    | 'INVALID_MODEL_ID';

/**
 * Provider 호출 실패를 표현하는 표준 에러 클래스
 *
 * @example
 *   throw new ProviderError('MISSING_API_KEY', 'ANTHROPIC_API_KEY 미설정');
 *   throw new ProviderError('UPSTREAM_ERROR', 'Anthropic 5xx', originalError);
 */
export class ProviderError extends Error {
    constructor(
        public readonly code: ProviderErrorCode,
        message: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'ProviderError';
    }
}
