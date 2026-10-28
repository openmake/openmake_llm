/**
 * 실행 소유권(176) 판별 SQL 조각(#1473) — 부팅 마킹·복구 조회·claim·주차·복구 상한이 같은 경계를 쓰도록 한곳에 모았다.
 * 순수 함수만 둔다(DB·repository import 없음 — 순환 방지). TS 짝 hasLiveLease 는 agent-task-lease-repository 에 있다.
 *
 * @module data/repositories/agent-task-lease-sql
 */

/**
 * 지난 소유권 조건(#1473) — 소유권을 잡은 적 있고(NOT NULL) 만료됐다. NULL(소유권을 잡은 적 없음 — 레거시·소유권 꺼짐)은
 * 살아 있지도 지나지도 않았다. TS 짝은 hasLiveLease — 둘이 같은 경계를 쓴다.
 */
export function expiredLeaseSql(col = 'lease_until'): string {
    return `${col} IS NOT NULL AND ${col} < NOW()`;
}

/**
 * 다른 서버의 살아 있는 소유권이 아님(#1473) — 소유권이 없거나(NULL — 종전 작업), ownerExpr(내 것)이거나, 지났다.
 * ownerExpr 는 SQL 식 그대로 들어간다(`$2` 같은 자리표시자나 코드가 만든 리터럴만 — 사용자 입력 금지).
 */
export function claimableLeaseSql(ownerExpr: string): string {
    return `(lease_owner IS NULL OR lease_owner = ${ownerExpr} OR lease_until < NOW())`;
}

/**
 * claim 과 running 사이에서 죽은 pending(#1473, 2026-10-22 R2) — claim 이 같은 문장에서 소유권을 쓰므로 소유권 있는 pending 은
 * 진행 중이던 claim 이다. 실행한 적 없는 pending 은 소유권이 NULL 이라 빠진다.
 */
export function orphanedClaimSql(statusCol: string, leaseCol: string): string {
    return `(${statusCol} = 'pending' AND ${leaseCol} IS NOT NULL)`;
}

/**
 * 다시 잡아도 되는 claim 고아(#1473) — orphanedClaimSql 이면서 소유권이 지났거나 ownerExpr(내 것)이다. 목록을 읽은 뒤 다른 서버가
 * 다시 claim 한 pending(살아 있는 남의 소유권)은 빠진다 — 복구 claim·기기 대기 주차·복구 상한 종료가 같이 쓴다.
 */
export function reclaimableOrphanSql(statusCol: string, leaseCol: string, ownerCol: string, ownerExpr: string): string {
    return `(${orphanedClaimSql(statusCol, leaseCol)} AND (${leaseCol} < NOW() OR ${ownerCol} = ${ownerExpr}))`;
}
