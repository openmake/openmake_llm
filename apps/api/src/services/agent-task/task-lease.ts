/**
 * 작업 실행 소유권(lease) + heartbeat (176).
 *
 * 실행 중인 에이전트 작업의 소유권은 종전에 프로세스 메모리(AgentTaskService.running)뿐이었다. 서버가 죽으면 그 서버가
 * 다시 뜰 때까지 아무도 그 작업을 이어받지 못했고, 부팅 때의 일괄 실패 표시는 다른 서버가 실행 중인 작업까지 건드렸다.
 *
 * - 실행을 시작할 때 `agent_tasks.lease_owner`·`lease_until` 을 잡는다. 다른 서버의 살아 있는 소유권이 있으면 잡지 못한다
 *   (이 프로세스가 claim 해 둔 행이 아직 queued·pending 이면 failed 로 닫는다 — 고아 claim 방지).
 * - LEASE_MS/3 마다 조건부 UPDATE(owner 일치)로 연장한다. 0행이면 다른 서버가 가져간 것 — 호출부에 알려 실행을 멈추게 한다.
 * - 끝나면 반납한다. 잃은 소유권은 반납하지 않는다(새 소유자의 것이다).
 * - 소유권이 지난 작업은 주기 점검(boot-recovery.sweepExpiredTaskLeases)이 가져가 체크포인트에서 이어 실행한다.
 *
 * owner 는 `호스트명:PM2 인스턴스 번호`(config/lease-owner) — 같은 자리에서 다시 뜬 프로세스가 자기 작업을 바로 알아본다.
 * DB 오류(컬럼 없음 포함)는 실행을 막지 않는다 — 그 실행은 소유권 없이 종전처럼 돈다.
 *
 * @module services/agent-task/task-lease
 */
import { getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AgentTaskRunRepository } from '../../data/repositories/agent-task-run-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';
import { leaseOwner } from '../../config/lease-owner';

const logger = createLogger('AgentTaskLease');

export { leaseOwner, sanitizeLeaseOwner } from '../../config/lease-owner';

export interface TaskLease {
    /** false 면 다른 서버가 실행 중 — 이 프로세스는 실행하지 않는다 */
    acquired: boolean;
    /** 연장을 멈추고 소유권을 반납한다(잃었거나 잡지 못했으면 반납하지 않는다) */
    end: () => Promise<void>;
}

/** 다른 서버의 살아 있는 소유권 때문에 시작하지 못한 작업의 error 코드 — config/agent-task-failure-class 에서 interrupted 로 분류 */
export const AGENT_TASK_LEASE_HELD_ERROR = 'lease_held_elsewhere';

const NO_LEASE: TaskLease = { acquired: true, end: async () => undefined };

/**
 * 소유권을 잡지 못해 시작하지 못한 실행의 claim 닫기 — 호출부(라우트·복구·주차 재개)는 이미 claim 하고 'started' 로 알았다.
 * 아직 claim 상태(queued·pending)면 failed 로 닫아 실행·대기 항목 없는 행을 남기지 않는다. 다른 서버가 실제로 실행 중인
 * 행(running 등)은 조건에 안 맞아 그대로다. 절대 throw 하지 않는다.
 */
async function closeUnstartedClaim(taskId: string): Promise<void> {
    try {
        await new AgentTaskRunRepository(getPool()).failUnstartedClaim(taskId, AGENT_TASK_LEASE_HELD_ERROR);
    } catch (e) {
        logger.warn(`[${taskId}] 시작하지 못한 claim 정리 실패: ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * 소유권을 잡고 연장을 시작한다. onLost: 연장이 0행으로 끝났을 때 한 번 불린다(다른 서버가 가져감) —
 * 호출부는 실행을 멈추고 이 작업의 상태·자원을 더 건드리지 않아야 한다.
 */
export async function beginTaskLease(taskId: string, onLost: () => void): Promise<TaskLease> {
    if (!AGENT_TASK_LIMITS.LEASE_ENABLED) return NO_LEASE;
    const me = leaseOwner();
    const leaseMs = AGENT_TASK_LIMITS.LEASE_MS;
    const repo = (): AgentTaskRepository => new AgentTaskRepository(getPool());
    try {
        if (!(await repo().acquireLease(taskId, me, leaseMs))) {
            logger.warn(`[${taskId}] 다른 서버가 실행 중인 작업 — 이 프로세스는 실행하지 않는다`);
            await closeUnstartedClaim(taskId);
            return { acquired: false, end: async () => undefined };
        }
    } catch (e) {
        logger.warn(`[${taskId}] 소유권 기록 실패 — 소유권 없이 실행한다: ${e instanceof Error ? e.message : e}`);
        return NO_LEASE;
    }
    let lost = false;
    const timer = setInterval(() => {
        void repo().renewLease(taskId, me, leaseMs).then((ok) => {
            if (ok || lost) return;
            lost = true;
            clearInterval(timer);
            logger.warn(`[${taskId}] 소유권을 잃음(다른 서버가 가져감) — 실행을 멈춘다`);
            onLost();
        }).catch((e) => {
            // 일시적 DB 오류 — 다음 주기에 다시 시도한다. 그 사이 소유권이 지나 다른 서버가 가져가면 다음 연장이 0행이다.
            logger.warn(`[${taskId}] 소유권 연장 실패(다음 주기에 재시도): ${e instanceof Error ? e.message : e}`);
        });
    }, Math.floor(leaseMs / 3));
    timer.unref();
    return {
        acquired: true,
        end: async () => {
            clearInterval(timer);
            if (lost) return;
            await repo().releaseLease(taskId, me).catch((e) => logger.warn(`[${taskId}] 소유권 반납 실패(만료로 정리된다): ${e instanceof Error ? e.message : e}`));
        },
    };
}
