/**
 * 마지막 진행 시각 추적기(191, R8) — 턴·도구 결과·상태 갱신마다 메모리에 시각만 적고, 주기 flush(schedulers 7-d)가 DB 에 쓴다.
 * 진행마다 DB 를 치지 않으려고 모은다. 같은 작업은 가장 늦은 시각 하나만 남는다.
 *
 * @module services/agent-task/progress-tracker
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskProgressRepository } from '../../data/repositories/agent-task-progress-repository';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskProgress');

/** 아직 DB 에 쓰지 않은 진행 — taskId → 시각(ms) */
const dirty = new Map<string, number>();

/** 진행 기록 — 더 늦은 시각만 남긴다 */
export function touchProgress(taskId: string, now = Date.now()): void {
    const prev = dirty.get(taskId);
    if (prev === undefined || now > prev) dirty.set(taskId, now);
}

/** 실행이 끝난 작업의 쓰지 않은 진행을 버린다 */
export function clearProgress(taskId: string): void {
    dirty.delete(taskId);
}

/**
 * 모은 진행을 꺼내(비우고) DB 에 쓴다 — 반환은 갱신된 행 수. 실패는 경고만 남기고 되돌려 넣지 않는다(다음 진행이 다시 쓴다).
 */
export async function flushProgressNow(): Promise<number> {
    if (dirty.size === 0) return 0;
    const entries = [...dirty].map(([taskId, at]) => ({ taskId, at: new Date(at) }));
    dirty.clear();
    try {
        return await new AgentTaskProgressRepository(getPool()).flushProgress(entries);
    } catch (err) {
        logger.warn(`[AgentTask] 진행 시각 저장 실패(${entries.length}건, 다음 진행이 다시 쓴다): ${err instanceof Error ? err.message : String(err)}`);
        return 0;
    }
}

/** 테스트용 — 아직 쓰지 않은 진행 */
export function getProgressSnapshot(): ReadonlyMap<string, number> {
    return new Map(dirty);
}
