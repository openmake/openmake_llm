/**
 * 승인 정책의 저장·복원 — 주차(승인 대기·기기 대기)에서 재개된 작업이 처음의 승인 정책을 잃지 않게 한다.
 *
 * 재개 경로(hitl-park 의 resumeParkedTask 등)는 요청 본문 없이 DB 행만으로 실행 입력을 다시 만든다. 정책을 행에
 * 남기지 않으면 로컬 실행은 기본값 'all' 로 돌아가, "건너뜀"으로 시작한 작업이 재개 뒤 읽기까지 다시 물었다(2026-10-05 실측).
 *
 * @module services/agent-task/approval-policy-restore
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskParkRepository } from '../../data/repositories/agent-task-park-repository';
import type { AgentTaskRunInput } from './types';

type ApprovalPolicy = NonNullable<AgentTaskRunInput['approvalPolicy']>;
const POLICIES: readonly string[] = ['all', 'high-risk', 'none'] satisfies readonly ApprovalPolicy[];

type PolicyInput = { approvalPolicy?: ApprovalPolicy; resume?: unknown };

/** PURE: 이번 실행에 쓸 정책 — 요청 값이 먼저, 재개면 저장값, 그 밖에는 정하지 않는다(실행기 기본값). */
export function effectiveApprovalPolicy(input: PolicyInput, stored: string | null | undefined): ApprovalPolicy | undefined {
    if (input.approvalPolicy) return input.approvalPolicy;
    return input.resume && stored && POLICIES.includes(stored) ? (stored as ApprovalPolicy) : undefined;
}

/** PURE: 행에 저장할 정책 — 처음 시작하면서 정책을 지정했을 때만. 재개는 처음 값을 덮지 않는다. */
export function policyToPersist(input: PolicyInput): ApprovalPolicy | null {
    return !input.resume && input.approvalPolicy ? input.approvalPolicy : null;
}

/** 처음 시작이면 정책을 행에 남긴다. 저장 실패는 실행을 막지 않는다 — 재개 때 기본값으로 돌아갈 뿐이다. */
export async function persistApprovalPolicy(taskId: string, input: PolicyInput): Promise<void> {
    const policy = policyToPersist(input);
    if (!policy) return;
    await new AgentTaskParkRepository(getPool()).setApprovalPolicy(taskId, policy).catch(() => undefined);
}
