/**
 * 에이전트 작업의 반출 판정 (하네스 P0-2) — 작업 목표·첨부 텍스트와 실행기로 config/egress-policy 의 판정을 내린다.
 * 실행기 선택(executor-select)·역할 모델(role-client)·감사(internal-only-audit)가 같은 판정을 쓴다.
 *
 * @module services/agent-task/task-egress
 */
import { decideEgress, type EgressDecision } from '../../config/egress-policy';
import type { AgentTaskRunInput } from './types';

export type TaskEgressInput = Partial<Pick<AgentTaskRunInput, 'executor' | 'goal' | 'files'>>;

/** PURE(설정 읽기): 작업의 반출 판정 — 같은 입력이면 같은 결과(여러 곳에서 불러도 된다). */
export function decideTaskEgress(input: TaskEgressInput): EgressDecision {
    return decideEgress({
        executor: input.executor,
        texts: [input.goal, ...(input.files ?? []).map((f) => f.content)],
    });
}
