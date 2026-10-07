/**
 * 추론 수준의 저장·복원(184) — 재개·분기된 작업이 처음의 선택을 잃지 않게 한다. approval-policy-restore(183)와 같은 모양.
 *
 * 재개 경로(hitl-park 의 resumeParkedTask, boot-recovery, /resume)는 요청 본문 없이 DB 행만으로 실행 입력을 다시 만든다.
 * 행에 남기지 않으면 'off' 로 돌아가, 사용자가 '높음'으로 시작한 작업이 주차 뒤 추론 없이 이어진다.
 *
 * @module services/agent-task/thinking-level-restore
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskParkRepository } from '../../data/repositories/agent-task-park-repository';
import { AGENT_TASK_THINKING_LEVELS, type AgentTaskThinkingLevel } from './types';

type LevelInput = { thinkingLevel?: AgentTaskThinkingLevel; resume?: unknown };

const isLevel = (v: unknown): v is AgentTaskThinkingLevel => typeof v === 'string' && (AGENT_TASK_THINKING_LEVELS as readonly string[]).includes(v);

/** PURE: 이번 실행에 쓸 수준 — 요청값이 먼저, 재개면 저장값, 그 밖에는 'off'(종전 동작). */
export function effectiveThinkingLevel(input: LevelInput, stored: string | null | undefined): AgentTaskThinkingLevel {
    if (input.thinkingLevel) return input.thinkingLevel;
    return input.resume && isLevel(stored) ? stored : 'off';
}

/** PURE: 행에 저장할 수준 — 처음 시작하면서 지정했을 때만. 재개는 처음 값을 덮지 않는다. */
export function thinkingLevelToPersist(input: LevelInput): AgentTaskThinkingLevel | null {
    return !input.resume && input.thinkingLevel ? input.thinkingLevel : null;
}

/** 처음 시작이면 수준을 행에 남긴다. 저장 실패는 실행을 막지 않는다 — 재개 때 'off' 로 돌아갈 뿐이다. */
export async function persistThinkingLevel(taskId: string, input: LevelInput): Promise<void> {
    const level = thinkingLevelToPersist(input);
    if (!level) return;
    await new AgentTaskParkRepository(getPool()).setThinkingLevel(taskId, level).catch(() => undefined);
}
