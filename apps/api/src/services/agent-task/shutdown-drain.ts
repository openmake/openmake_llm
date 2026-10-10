/**
 * 서버 종료 때의 실행 중 에이전트 작업 정리 — boot/graceful-shutdown 의 한 단계.
 *
 * 종전엔 SIGTERM(배포·재시작) 때 실행 중인 작업이 아무 정리 없이 끊겼다: 종료 절차가 DB 풀을 닫은 뒤에도 루프가 돌아
 * DB 오류를 냈고, 샌드박스 컨테이너와 실행 소유권(lease)이 남아 다음 부팅의 복구가 소유권 만료·상태 추정에 기댔다.
 *
 * - 종료가 시작되면 새 실행을 시작하지 않는다(AgentTaskService.execute 의 입구 — 라우트·큐 대기열·예약·트리거·주차 재개·
 *   소유권 점검이 모두 여기를 지난다). 호출부가 이미 잡아 둔 행(pending)은 queued 로 돌려 둔다 — 부팅 복구가 집는 상태다.
 * - 실행 중인 작업에는 종료 사유를 실어 중단 신호를 보낸다. 사용자 취소(cancelled)와 달리 `failed` + 'server restarted' 로
 *   남긴다 — 비정상 종료 뒤 schema-initializer 가 남기는 것과 같은 표식이라 부팅 복구가 체크포인트에서 이어 실행한다.
 * - 각 실행의 종료 정리(소유권 반납·컨테이너 정리)가 끝나기를 상한까지 기다린다. 넘으면 그대로 두고 돌아온다 —
 *   그 작업은 종전처럼 다음 부팅의 좀비 정리·복구가 맡는다.
 *
 * 주차(paused, 질문 응답 대기) 중인 작업은 이 프로세스에 실행이 없으므로 대상이 아니다.
 *
 * @module services/agent-task/shutdown-drain
 */
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskShutdown');

/** 종료로 끊긴 작업의 error — 부팅 복구 조회(AgentTaskRepository.getInterruptedAgentTasks)와 schema-initializer 의 좀비 정리가 쓰는 표식과 같아야 한다 */
export const AGENT_TASK_RESTART_ERROR = 'server restarted';

/** 종료가 보낸 중단 신호의 사유(AbortSignal.reason) — 사용자 취소·소유권 상실의 abort 와 구분한다 */
export const AGENT_TASK_SHUTDOWN_ABORT = Symbol('agent-task-shutdown');

interface AbortableRun { abort(reason?: unknown): void }

let shuttingDown = false;
/** 시작부터 종료 정리(finally)까지 끝나지 않은 실행 — 서비스 레지스트리(running)는 종료 정리 전에 비워져 기다릴 대상이 못 된다 */
const inFlight = new Map<AbortableRun, Promise<void>>();

export function isAgentTaskShutdown(): boolean { return shuttingDown; }

/** 새 실행 시작을 막는다 — 종료의 첫 단계가 부른다(연결 정리를 기다리는 동안 들어오는 요청·예약 발화 포함) */
export function beginAgentTaskShutdown(): void { shuttingDown = true; }

/** 테스트 전용 — 종료 표시를 되돌린다 */
export function resetAgentTaskShutdownForTest(): void { shuttingDown = false; inFlight.clear(); }

/** 이 중단이 서버 종료 때문인가 — 먼저 사용자 취소로 중단된 신호는 사유가 바뀌지 않아 false 다(취소가 이긴다) */
export function isShutdownAbort(signal: AbortSignal): boolean {
    return signal.aborted && signal.reason === AGENT_TASK_SHUTDOWN_ABORT;
}

/**
 * 종료가 시작된 뒤 들어온 실행을 시작하지 않고 닫는다. 호출부(주차 재개·부팅 복구·예약·트리거)가 claim·생성으로 남긴
 * pending 은 부팅 복구의 조회 대상이 아니므로 queued 로 돌려 둔다(체크포인트가 있으면 이어서, 없으면 처음부터 다시 디스패치된다).
 * 절대 throw 하지 않는다.
 */
async function requeueRefusedStart(taskId: string): Promise<void> {
    try {
        const db = getUnifiedDatabase();
        const task = await db.getAgentTask(taskId);
        if (task?.status === 'pending') await db.updateAgentTask(taskId, { status: 'queued' });
        logger.info(`[${taskId}] 서버 종료 중 — 실행을 시작하지 않는다(다음 부팅의 복구가 다시 디스패치)`);
    } catch (e) {
        logger.warn(`[${taskId}] 종료 중 거절한 실행의 상태 정리 실패: ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * AgentTaskService.execute 의 입구 — 종료 중이면 시작하지 않고, 아니면 실행을 종료 정리가 끝날 때까지 추적한다.
 * run 은 throw 하지 않는다(execute 가 모든 종료 경로를 흡수한다).
 */
export async function trackAgentTaskRun(svc: AbortableRun, taskId: string, run: () => Promise<void>): Promise<void> {
    if (shuttingDown) return requeueRefusedStart(taskId);
    const done = run();
    inFlight.set(svc, done);
    try { await done; } finally { inFlight.delete(svc); }
}

/**
 * 종료로 끊긴 실행의 상태 기록 — 부팅 복구가 집는 표식으로 남긴다. 종료 알림 표식은 세우되 여기서 알리지는 않는다:
 * 복구가 다시 살리면 종료 상태가 아니게 되어 알림 대상에서 빠지고, 살리지 못하면(체크포인트 없음) 주기 점검이 알린다.
 * usage: 그때까지의 누적 토큰 — 재개가 이어서 센다. 절대 throw 하지 않는다.
 */
export async function recordShutdownInterrupt(taskId: string, usage: { totalTokens: number; cachedPromptTokens?: number; cacheReportedPromptTokens?: number }): Promise<void> {
    await getUnifiedDatabase().updateAgentTask(taskId, { status: 'failed', error: AGENT_TASK_RESTART_ERROR, terminalNotifyPending: true, ...usage })
        .catch((e) => logger.warn(`[${taskId}] 종료 중단 기록 실패(다음 부팅의 좀비 정리가 맡는다): ${e instanceof Error ? e.message : e}`));
    logger.info(`[${taskId}] 서버 종료로 실행 중단 — 다음 부팅의 복구가 체크포인트에서 이어 실행한다`);
}

/**
 * 실행 중인 작업을 모두 중단시키고 종료 정리가 끝나기를 timeoutMs 까지 기다린다.
 * @returns aborted: 중단 신호를 보낸 실행 수, remaining: 상한 안에 정리가 끝나지 않은 실행 수
 */
export async function drainAgentTasksForShutdown(timeoutMs: number): Promise<{ aborted: number; remaining: number }> {
    beginAgentTaskShutdown();
    const runs = [...inFlight];
    if (runs.length === 0) return { aborted: 0, remaining: 0 };
    for (const [svc] of runs) svc.abort(AGENT_TASK_SHUTDOWN_ABORT);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
        Promise.allSettled(runs.map(([, done]) => done)),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
    ]);
    clearTimeout(timer);
    const remaining = runs.filter(([svc]) => inFlight.has(svc)).length;
    if (remaining > 0) logger.warn(`실행 중 작업 ${runs.length}건 중 ${remaining}건이 ${timeoutMs}ms 안에 정리되지 않음 — 다음 부팅의 복구에 맡긴다`);
    else logger.info(`실행 중 작업 ${runs.length}건 중단·정리 완료`);
    return { aborted: runs.length, remaining };
}
