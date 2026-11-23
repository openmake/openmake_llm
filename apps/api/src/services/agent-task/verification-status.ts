/**
 * 검증 결과 4상태 (하네스 P1-4) — 완료 관문의 검증(산출물 검사·테스트 게이트·goal judge)을 한 값으로 모은다.
 *
 *   passed       검증을 실제로 돌려 통과했다.
 *   not_run      검증할 대상·러너가 없어 돌리지 않았다(리포트형 작업 대부분).
 *   failed       검증이 실패했고 재시도 상한 안에 고치지 못했다(상한을 넘겨 건너뛴 게이트 포함).
 *   inconclusive 검증 인프라 오류·판정 호출 실패로 결과를 알 수 없다.
 *
 * 종전에는 not_run·inconclusive 가 모두 "통과(ok=true)" 로 보였다. 이 값은 `agent_tasks.verification_status`(204)에
 * 남고, AGENT_TASK_VERIFY_STRICT=true 면 failed 인 완료가 completed 가 아니라 failed(verification_failed)로 끝난다.
 *
 * @module services/agent-task/verification-status
 */

export type VerificationStatus = 'passed' | 'not_run' | 'failed' | 'inconclusive';

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = ['passed', 'not_run', 'failed', 'inconclusive'];

/** strict 모드에서 failed 로 끝낼 때의 error 코드(실패 분류 goal_incomplete). */
export const VERIFICATION_FAILED_ERROR = 'verification_failed';

/** PURE: 개별 검증 결과를 합친다 — failed > inconclusive > passed > not_run. 빈 목록은 not_run. */
export function combineVerification(parts: ReadonlyArray<VerificationStatus | undefined>): VerificationStatus {
    const seen = new Set(parts.filter((p): p is VerificationStatus => p !== undefined));
    if (seen.has('failed')) return 'failed';
    if (seen.has('inconclusive')) return 'inconclusive';
    if (seen.has('passed')) return 'passed';
    return 'not_run';
}
