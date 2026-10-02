/**
 * 에이전트 작업 진행 이벤트 기록 — 순번·재전송.
 *
 * `agent_task_progress` 는 프로세스 안 이벤트 버스에서 소켓으로 바로 나가, 소켓이 잠깐 끊긴 사이(탭 백그라운드·절전·
 * 느린 연결 건너뛰기)의 이벤트는 사라졌다. 여기서는 이벤트마다 순번(seq)·시각(ts)을 붙여 사용자별로 잠깐 보관하고,
 * 재연결한 클라이언트가 `agent_task_resume{afterSeq}` 를 보내면 그 뒤 이벤트만 다시 준다.
 * 보관 범위를 벗어난 이벤트가 재생 범위에 있었으면 gap — 클라이언트는 REST 로 다시 읽는다(진실의 원천은 DB).
 *
 * 순번은 프로세스 시작 시각에서 출발한다 — 재시작해도 이전 실행의 순번보다 크므로, 재시작 전 순번을 든 클라이언트는
 * 항상 gap 으로 판정된다(별도 세대 표시가 필요 없다).
 *
 * 인메모리(프로세스 하나) — 서버를 여러 대로 늘리면 작업이 도는 서버와 소켓이 붙은 서버가 달라질 수 있어
 * 서버 간 중계가 따로 필요하다(utils/event-bus 머리말).
 *
 * @module sockets/agent-task-progress-log
 */
import { AGENT_TASK_PROGRESS_LOG } from '../config/runtime-limits';

export type SequencedEvent<T> = T & { seq: number; ts: number };

interface UserLog {
    events: Array<SequencedEvent<Record<string, unknown>>>;
    /** 버린 이벤트 중 가장 큰 순번 — 클라이언트의 afterSeq 가 이보다 작으면 놓친 이벤트가 있다 */
    droppedUpTo: number;
}

export class AgentTaskProgressLog {
    private readonly users = new Map<string, UserLog>();
    private readonly startSeq: number;
    private seq: number;
    private readonly maxEvents: number;
    private readonly ttlMs: number;
    /** 통째로 정리한 사용자 기록의 마지막 순번 중 최댓값 — 기록이 없는 사용자의 gap 판정 근거(보수적) */
    private removedUpTo = 0;
    private appendsSinceSweep = 0;

    constructor(opts: { startSeq?: number; maxEvents?: number; ttlMs?: number } = {}) {
        this.startSeq = opts.startSeq ?? Date.now() * 1000;
        this.seq = this.startSeq;
        this.maxEvents = opts.maxEvents ?? AGENT_TASK_PROGRESS_LOG.MAX_EVENTS_PER_USER;
        this.ttlMs = opts.ttlMs ?? AGENT_TASK_PROGRESS_LOG.TTL_MS;
    }

    /** 순번·시각을 붙여 보관하고, 붙인 이벤트를 돌려준다(그대로 소켓에 보낸다). */
    append<T extends Record<string, unknown>>(userId: string, event: T, now = Date.now()): SequencedEvent<T> {
        const stamped = { ...event, seq: ++this.seq, ts: now };
        let log = this.users.get(userId);
        if (!log) { log = { events: [], droppedUpTo: 0 }; this.users.set(userId, log); }
        log.events.push(stamped);
        this.prune(log, now);
        if (++this.appendsSinceSweep >= AGENT_TASK_PROGRESS_LOG.SWEEP_EVERY_APPENDS) this.sweep(now);
        return stamped;
    }

    /** afterSeq 뒤의 이벤트 + 놓친 이벤트가 있는지. afterSeq 가 없으면(순번을 모르는 클라이언트) 재생하지 않는다. */
    replay(userId: string, afterSeq: number | undefined, now = Date.now()): { events: Array<SequencedEvent<Record<string, unknown>>>; gap: boolean } {
        if (afterSeq === undefined) return { events: [], gap: false };
        const log = this.users.get(userId);
        if (log) this.prune(log, now);
        const droppedUpTo = Math.max(log?.droppedUpTo ?? 0, log ? 0 : this.removedUpTo);
        return {
            events: (log?.events ?? []).filter((e) => e.seq > afterSeq),
            gap: afterSeq < this.startSeq || afterSeq < droppedUpTo,
        };
    }

    /** 보관할 이벤트가 없어진 사용자 기록을 정리한다. */
    sweep(now = Date.now()): void {
        this.appendsSinceSweep = 0;
        for (const [userId, log] of this.users) {
            this.prune(log, now);
            if (log.events.length === 0) {
                this.removedUpTo = Math.max(this.removedUpTo, log.droppedUpTo);
                this.users.delete(userId);
            }
        }
    }

    userCount(): number { return this.users.size; }

    private prune(log: UserLog, now: number): void {
        let drop = 0;
        while (drop < log.events.length && (log.events.length - drop > this.maxEvents || now - log.events[drop].ts > this.ttlMs)) drop++;
        if (drop === 0) return;
        log.droppedUpTo = log.events[drop - 1].seq;
        log.events.splice(0, drop);
    }
}

let instance: AgentTaskProgressLog | null = null;
export function getAgentTaskProgressLog(): AgentTaskProgressLog {
    if (!instance) instance = new AgentTaskProgressLog();
    return instance;
}

/**
 * 재연결한 소켓에 놓친 진행 이벤트를 보낸다(`agent_task_resume{afterSeq}`). 빈틈이 있으면 `agent_task_resync` 를 먼저 보내
 * 클라이언트가 REST 로 다시 읽게 하고, 남아 있는 이벤트는 이어서 보낸다. 로그인하지 않은 연결·형식이 틀린 순번은 무시한다.
 */
export function replayAgentTaskProgress(
    ws: { send(data: string): void },
    userId: string | undefined,
    afterSeq: unknown,
    log: AgentTaskProgressLog = getAgentTaskProgressLog(),
): void {
    if (!userId || typeof afterSeq !== 'number' || !Number.isSafeInteger(afterSeq) || afterSeq < 0) return;
    const { events, gap } = log.replay(userId, afterSeq);
    if (gap) ws.send(JSON.stringify({ type: 'agent_task_resync' }));
    for (const e of events) ws.send(JSON.stringify(e));
}
