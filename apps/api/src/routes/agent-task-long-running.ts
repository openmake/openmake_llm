/**
 * 에이전트 작업 생성 라우트의 장기 실행 체인(188) 연결 — agent-task.routes.ts 줄 수 상한 때문에 분리.
 * 기능 게이트·역할·절대 상한은 longRunningCreateGate(PURE)가 판정하고, 거절은 ValidationError(400)로 던진다.
 * 통과하면 루트 작업은 자기 id 를 chainRootTaskId 로 갖는다.
 *
 * @module routes/agent-task-long-running
 */
import { AGENT_TASK_LONG_RUNNING } from '../config/agent-task-long-running';
import { longRunningCreateGate, type LongRunningRequest } from '../services/agent-task/long-running-budget';
import type { LongRunningBudget } from '../services/agent-task/types';
import { ValidationError } from '../utils/error-handler';

export function longRunningCreateFields(
    input: LongRunningRequest | undefined, role: unknown, taskId: string,
): { chainRootTaskId?: string; longRunning?: LongRunningBudget } {
    const lr = longRunningCreateGate(input, String(role ?? 'user'), Date.now(), AGENT_TASK_LONG_RUNNING.ENABLED);
    if (!lr.ok) throw new ValidationError(lr.reason);
    return lr.fields.longRunning ? { chainRootTaskId: taskId, longRunning: lr.fields.longRunning } : {};
}
