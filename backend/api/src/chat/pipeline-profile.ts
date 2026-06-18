/**
 * ============================================================
 * Pipeline Profile — ExecutionPlan 공용 type alias
 * ============================================================
 *
 * 단일 로컬 모델 환경에서 ExecutionPlan / 채팅 strategy 가 공유하는
 * narrow type alias 만 남았다 (이전의 brand profile 시스템 잔여).
 *
 * @module chat/pipeline-profile
 * @see chat/profile-resolver.ts - ExecutionPlan 정의에서 ExecutionStrategy 사용
 */

// ============================================
// 파이프라인 실행 전략
// ============================================

/**
 * 파이프라인 실행 전략
 *
 * - 'single': 단일 모델 응답 (도구 호출 비활성화)
 * - 'generate-verify': 항상 Generator→Verifier 2단계 실행 (품질 최우선)
 * - 'conditional-verify': 복잡도 평가 후 조건부 검증 (균형)
 *
 * @see services/chat-strategies/generate-verify-strategy.ts
 */
export type ExecutionStrategy = 'single' | 'generate-verify' | 'conditional-verify';

