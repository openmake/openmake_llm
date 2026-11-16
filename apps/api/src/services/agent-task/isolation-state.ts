/**
 * 로컬 실행의 worktree 격리 상태 기록(200) — AgentTaskService·run-cleanup 에서 분리(파일 크기 가드).
 *
 * - 시작(재개 포함): 실행기가 정한 값을 작업 행에 쓰고 진행 이벤트로 한 번 알린다(채팅 카드).
 *   로컬 새 실행인데 값이 없으면(실행기 준비 실패 등) NULL 로 비워 앞선 시도의 값이 남지 않게 한다.
 * - 종료 정리 뒤: 종료 상태(completed·failed·cancelled)에서만 정리 결과(outcome)를 다시 쓰고 reason 'isolation' 이벤트를 낸다.
 *   주차·서버 종료 중단은 종료가 아니다 — 변경 없는 worktree 는 기기가 지웠다가 재개 때 같은 이름으로 다시 만든다.
 *
 * 모두 fail-open — 표시용 상태라 쓰기 실패가 작업을 멈추지 않는다.
 *
 * @module services/agent-task/isolation-state
 */
import type { AgentTaskIsolation } from '@openmake/shared-types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { emitAgentTaskProgress } from '../../utils/event-bus';
import { isTerminalStatus } from './terminal-notify';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskIsolation');

interface ProgressSnapshot {
    taskId: string;
    userId: string;
    status: string;
    progress: number;
    currentTurn: number;
}

export async function recordIsolationStart(opts: ProgressSnapshot & {
    /** 로컬 실행기 작업인가 — 샌드박스는 해당 없음 */
    local: boolean;
    resume: boolean;
    isolation: AgentTaskIsolation | null;
}): Promise<void> {
    const { taskId, userId, status, progress, currentTurn, isolation } = opts;
    if (!opts.local || (!isolation && opts.resume)) return;
    try {
        await getUnifiedDatabase().updateAgentTask(taskId, { isolation });
    } catch (e) {
        logger.warn(`[${taskId}] 격리 상태 기록 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    if (isolation) emitAgentTaskProgress({ userId, taskId, status, progress, currentTurn, isolation });
}

export async function recordIsolationOutcome(opts: ProgressSnapshot & {
    /** 주차·서버 종료 중단 — 종료가 아니라 결과를 쓰지 않는다 */
    parked: boolean;
    isolation: AgentTaskIsolation | null;
}): Promise<void> {
    const { taskId, userId, status, progress, currentTurn, isolation } = opts;
    if (opts.parked || !isTerminalStatus(status) || isolation?.state !== 'worktree' || !isolation.outcome) return;
    try {
        await getUnifiedDatabase().updateAgentTask(taskId, { isolation });
    } catch (e) {
        logger.warn(`[${taskId}] 격리 정리 결과 기록 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
        return;
    }
    emitAgentTaskProgress({ userId, taskId, status, progress, currentTurn, isolation, reason: 'isolation' });
}
