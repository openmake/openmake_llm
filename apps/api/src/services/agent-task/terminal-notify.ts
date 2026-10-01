/**
 * 에이전트 작업 종료 알림 — 화면 이벤트(agent_task_progress) + 푸시, 그리고 유실분 재전송.
 *
 * 종료 상태(completed·failed·cancelled)를 쓰는 쪽이 같은 DB 쓰기로 `terminal_notify_pending=true` 를 남기고,
 * 여기서 알림을 보낸 뒤 지운다. 결과 저장과 알림 사이에 프로세스가 죽으면 표식이 남아 주기 점검이 다시 보낸다.
 * (CopilotKit/openmuse `service.ts` 의 maintain 과 같은 발상 — 결과는 있는데 알림이 안 나간 작업을 다시 알린다.)
 * 정상 경로는 "보낸 뒤 지움"이라 드물게 두 번 갈 수 있고(보낸 직후 죽은 경우), 재전송은 "가져오며 지움"이라 한 번만 간다.
 * @module services/agent-task/terminal-notify
 */
import { emitAgentTaskProgress } from '../../utils/event-bus';
import { getPushService } from '../PushService';
import { getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import { AGENT_TASK_TERMINAL_NOTIFY } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskTerminalNotify');

const PUSH_GOAL_MAX_CHARS = 60;
const STATUS_LABEL: Record<string, string> = { completed: '완료', failed: '실패', cancelled: '취소' };

export interface TerminalNotice {
    userId: string;
    taskId: string;
    goal: string;
    status: string;
    progress: number;
    currentTurn: number;
}

export type TerminalNotifyRepo = Pick<AgentTaskRepository, 'clearTerminalNotifyPending' | 'claimPendingTerminalNotifications'>;

function defaultRepo(): TerminalNotifyRepo {
    return new AgentTaskRepository(getPool());
}

/** 종료 상태인가 — 이 상태로 바뀔 때만 알림 표식을 남긴다. */
export function isTerminalStatus(status: string | undefined): boolean {
    return status !== undefined && status in STATUS_LABEL;
}

/** 화면 이벤트 + 푸시. 어떤 실패도 밖으로 던지지 않는다 — 알림은 부가 동작이라 작업의 종료 처리를 깨면 안 된다. */
async function send(n: TerminalNotice, emit: boolean): Promise<void> {
    try {
        if (emit) emitAgentTaskProgress({ userId: n.userId, taskId: n.taskId, status: n.status, progress: n.progress, currentTurn: n.currentTurn });
        const shortGoal = n.goal.length > PUSH_GOAL_MAX_CHARS ? `${n.goal.slice(0, PUSH_GOAL_MAX_CHARS)}…` : n.goal;
        // 페이지가 닫혀 있어도 알림. VAPID 미설정·구독 없음은 PushService 가 no-op 으로 끝낸다.
        await getPushService().sendPush(n.userId, {
            title: 'OpenMake 에이전트 작업',
            body: `작업이 ${STATUS_LABEL[n.status] ?? n.status}되었습니다: ${shortGoal}`,
            url: '/agent-tasks',
        });
    } catch { /* 구독 만료·푸시 초기화 실패 등 — 다시 보내도 같다 */ }
}

/**
 * 종료 알림을 보내고 표식을 지운다(fire-and-forget — 실행 루프를 기다리게 하지 않고, 던지지도 않는다).
 * opts.emit=false: 호출부가 화면 이벤트를 이미 발행했을 때. repo 미지정이면 기본 저장소를 알림 뒤에 만든다.
 */
export function notifyTaskTerminal(n: TerminalNotice, repo?: TerminalNotifyRepo, opts: { emit?: boolean } = {}): void {
    void send(n, opts.emit !== false)
        .then(() => (repo ?? defaultRepo()).clearTerminalNotifyPending(n.taskId))
        .catch((err) => { logger.warn(`종료 알림 표식 정리 실패(다음 점검이 다시 보낸다): ${n.taskId} — ${err instanceof Error ? err.message : String(err)}`); });
}

/** 알림을 못 보낸 종료 작업을 다시 알린다. 보낸 건수를 돌려주고, 실패해도 던지지 않는다. */
export async function resendMissedTerminalNotifications(repo: TerminalNotifyRepo = defaultRepo()): Promise<number> {
    let rows: Awaited<ReturnType<TerminalNotifyRepo['claimPendingTerminalNotifications']>>;
    try {
        rows = await repo.claimPendingTerminalNotifications({
            graceMs: AGENT_TASK_TERMINAL_NOTIFY.GRACE_MS, windowMs: AGENT_TASK_TERMINAL_NOTIFY.WINDOW_MS, limit: AGENT_TASK_TERMINAL_NOTIFY.BATCH,
        });
    } catch (err) {
        logger.warn(`종료 알림 재전송 조회 실패(다음 주기에 재시도): ${err instanceof Error ? err.message : String(err)}`);
        return 0;
    }
    let sent = 0;
    for (const t of rows) {
        if (!t.user_id) continue;
        void send({ userId: String(t.user_id), taskId: t.id, goal: t.goal, status: t.status, progress: t.progress ?? 0, currentTurn: t.current_turn ?? 0 }, true);
        sent += 1;
    }
    if (sent > 0) logger.info(`종료 알림 재전송: ${sent}건`);
    return sent;
}

/** 부팅 직후 1회 + 주기 점검 등록. 타이머는 프로세스 종료를 막지 않는다. */
export function startTerminalNotifySweep(): void {
    void resendMissedTerminalNotifications();
    setInterval(() => { void resendMissedTerminalNotifications(); }, AGENT_TASK_TERMINAL_NOTIFY.SWEEP_MS).unref();
}
