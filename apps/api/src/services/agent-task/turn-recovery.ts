/**
 * 재시도 소진 뒤 대기 — 짧은 재시도가 다 실패한 일시적 오류를 더 긴 간격으로 기다린다.
 *
 * @module services/agent-task/turn-recovery
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';

/**
 * PURE: cycle 번째(1부터) 대기 시간(ms). 기다리지 않을 때는 null —
 * 꺼져 있거나, 주기를 다 썼거나, 남은 작업 예산(remainingMs)이 대기 시간 이하일 때(기다려도 다시 부를 시간이 없다).
 * 예산을 모르는 호출(remainingMs 없음)은 기다리지 않는다.
 */
export function recoveryWaitMs(cycle: number, remainingMs: number | undefined): number | null {
    if (!AGENT_TASK_TURN_LOOP.RECOVERY_WAIT_ENABLED || remainingMs === undefined) return null;
    if (cycle > AGENT_TASK_TURN_LOOP.RECOVERY_WAIT_MAX_CYCLES) return null;
    const waitMs = Math.min(AGENT_TASK_TURN_LOOP.RECOVERY_WAIT_CAP_MS, AGENT_TASK_TURN_LOOP.RECOVERY_WAIT_BASE_MS * 2 ** (cycle - 1));
    return waitMs < remainingMs ? waitMs : null;
}
