/**
 * Agent Task 동시성 큐 (Phase 3-B) — reliability.
 *
 * `/execute`·`/resume`·부팅복구가 지금까지 detached 로 **즉시 발사**해 LLM 루프 동시 실행이
 * 무제한이었다(샌드박스 maxConcurrent 는 컨테이너만 제한). 스케줄(3-A)이 생기면 폭주한다.
 *
 * 이 큐는 전역·유저별 동시 실행 상한을 강제한다. 상한 초과 시 'queued' 로 대기시키고,
 * 실행 슬롯이 비면 우선순위 높은 순·같으면 FIFO(유저 상한 준수)로 dequeue 한다(F16.6, 131). 단일 프로세스 전제(API instances:1) —
 * 멀티프로세스 확장 시 Redis 백엔드가 필요(현재 범위 밖).
 *
 * @module services/agent-task/task-queue
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';
import { getConfig } from '../../config/env';
import { getMetrics } from '../../monitoring/metrics';

const logger = createLogger('AgentTaskQueue');

/** 대기 시간 히스토그램(ms) — 등록부터 시작까지. 즉시 시작은 0. */
export const AGENT_TASK_QUEUE_WAIT_METRIC = 'agent_task_queue_wait_ms';

/** 최근 시작 건의 대기 시간 요약(ms). 건수 0 이면 나머지 null. */
export interface QueueWaitSummary { count: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null }

/** PURE: 대기 시간 목록 → 건수·중앙값·p95·최대(nearest-rank 백분위). */
export function summarizeQueueWaits(waits: readonly number[]): QueueWaitSummary {
    if (waits.length === 0) return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
    const sorted = [...waits].sort((a, b) => a - b);
    const rank = (p: number) => sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
    return { count: sorted.length, p50Ms: rank(50), p95Ms: rank(95), maxMs: sorted[sorted.length - 1] };
}

interface QueueEntry {
    taskId: string;
    userId: string;
    /** 실제 실행 — AgentTaskService.execute 를 감싼 thunk. 절대 throw 하지 않음(execute 가 내부 흡수). */
    run: () => Promise<void>;
    /** 대기열 우선순위(131) — 높을수록 먼저. 미지정 0. 값 검증은 resolveQueuePriority(호출부). */
    priority?: number;
    /** 대기 등록 시각(epoch ms) — 재시작 복구가 DB 에 남은 대기 시각을 넘긴다. 없으면 submit 시각. */
    enqueuedAt?: number;
}

export class AgentTaskQueue {
    private globalActive = 0;
    private readonly userActive = new Map<string, number>();
    private readonly pending: QueueEntry[] = [];
    /** 실행 중(시작~종료) taskId — 같은 작업의 중복 제출 거부(2026-10-09 점검 ①). 대기 중은 pending 에서 찾는다. 큐 비활성 경로(runDirect)도 여기에 든다. */
    private readonly active = new Set<string>();
    /** 자리 반납 뒤 한 번 실행할 재시도(taskId 당 1건) — 실행 중인 작업에만 등록되고 반납 때 지워진다. */
    private readonly releaseRetries = new Map<string, () => unknown>();
    /** 최근 시작 건의 대기 시간(ms) — 오래된 것부터 버린다. */
    private readonly recentWaits: number[] = [];

    constructor(
        private readonly globalMax: number = AGENT_TASK_LIMITS.QUEUE_GLOBAL_MAX,
        private readonly userMax: number = AGENT_TASK_LIMITS.QUEUE_USER_MAX,
        private readonly waitSampleSize: number = AGENT_TASK_LIMITS.QUEUE_WAIT_SAMPLE_SIZE,
        private readonly now: () => number = Date.now,
    ) {}

    /** 즉시 실행 가능하면 start('started'), 아니면 대기열 등록('queued'). */
    submit(entry: QueueEntry): 'started' | 'queued' | 'duplicate' {
        if (this.has(entry.taskId)) {
            logger.warn(`[Queue] 같은 작업이 이미 실행·대기 중 — 제출 거부: ${entry.taskId}`);
            return 'duplicate';
        }
        const queued = { ...entry, enqueuedAt: entry.enqueuedAt ?? this.now() };
        if (this.canRun(entry.userId)) {
            this.start(queued);
            return 'started';
        }
        this.pending.push(queued);
        logger.info(`[Queue] 대기 등록: ${entry.taskId} (대기 ${this.pending.length}, 실행 ${this.globalActive})`);
        return 'queued';
    }

    /**
     * 큐 비활성(기본) 경로의 즉시 실행 — 상한·대기·집계 없이 바로 시작하되 "실행 중" 표시(active)는 큐 경로와 같이 쓴다.
     * 그래서 has·duplicate 거절이 큐 on/off 와 무관하게 성립한다: thunk 는 AgentTaskService.execute 의 종료 정리(finally —
     * 서비스 레지스트리를 비운 뒤 샌드박스·승인 정리)까지 끝나야 resolve 하므로, 그 전의 재시도는 여기서 걸린다.
     * 막지 않으면 새 실행이 같은 이름의 샌드박스 컨테이너·workspace 를 만들고 이전 실행의 정리가 그것을 지운다.
     */
    runDirect(entry: QueueEntry): 'started' | 'duplicate' {
        if (this.has(entry.taskId)) {
            logger.warn(`[Queue] 같은 작업이 이미 실행(종료 정리) 중 — 실행 거부: ${entry.taskId}`);
            return 'duplicate';
        }
        this.active.add(entry.taskId);
        void entry.run()
            .catch((e) => logger.warn(`[Queue] 실행 예외(무시): ${entry.taskId} — ${e instanceof Error ? e.message : e}`))
            .finally(() => { this.active.delete(entry.taskId); this.runReleaseRetry(entry.taskId); });
        return 'started';
    }

    /**
     * 이 작업의 실행이 자리를 반납한 직후 retry 를 한 번 실행한다 — has 때문에 보류된 주차 재개가 다음 스윕(기본 10분)까지
     * 밀리지 않게. 실행 중(종료 정리 포함)일 때만 등록되고(아니면 무시), taskId 당 1건이라 거듭 등록해도 한 번만 돈다.
     * retry 의 실패·예외는 로그만 남긴다(주차 스윕이 다시 본다).
     */
    retryAfterRelease(taskId: string, retry: () => unknown): void {
        if (this.active.has(taskId)) this.releaseRetries.set(taskId, retry);
    }

    private runReleaseRetry(taskId: string): void {
        const retry = this.releaseRetries.get(taskId);
        if (!retry) return;
        this.releaseRetries.delete(taskId);
        void Promise.resolve().then(retry)
            .catch((e) => logger.warn(`[Queue] 자리 반납 뒤 재시도 실패(스윕에 맡김): ${taskId} — ${e instanceof Error ? e.message : e}`));
    }

    /**
     * 같은 작업이 실행 중(종료 정리 포함)이거나 대기 중인가 — submit 이 'duplicate' 로 거절하는 조건.
     * 되돌릴 수 없는 claim(주차 재개·부팅 복구)은 claim 전에 이것으로 확인한다.
     */
    has(taskId: string): boolean {
        return this.active.has(taskId) || this.pending.some((e) => e.taskId === taskId);
    }

    /** 대기 중인(아직 실행 전) task 를 취소로 제거. 실행 중이면 false(호출부가 AbortController 로 취소). */
    cancelPending(taskId: string): boolean {
        const i = this.pending.findIndex((e) => e.taskId === taskId);
        if (i < 0) return false;
        this.pending.splice(i, 1);
        return true;
    }

    /**
     * 대기 순번(1 부터) — 꺼낼 때와 같은 순서(우선순위 높은 순, 같으면 등록 순)에서 몇 번째인가. 대기 중이 아니면 null.
     * 사용자별 상한 때문에 실제 시작 순서는 달라질 수 있어 "앞에 최대 몇 건"의 안내값이다.
     */
    position(taskId: string): number | null {
        const i = this.pending.findIndex((e) => e.taskId === taskId);
        if (i < 0) return null;
        const mine = this.pending[i].priority ?? 0;
        let ahead = 0;
        for (let j = 0; j < this.pending.length; j++) {
            if (j === i) continue;
            const p = this.pending[j].priority ?? 0;
            if (p > mine || (p === mine && j < i)) ahead++;
        }
        return ahead + 1;
    }

    /**
     * 관측용 스냅샷 — byPriority 는 대기 중 항목의 우선순위별 개수.
     * wait.recent 는 최근 시작 N건의 대기 시간 요약, wait.oldestPendingMs 는 지금 대기 중인 항목 중 가장 오래 기다린 시간(없으면 null).
     */
    stats(): {
        globalActive: number; pending: number; byPriority: Record<string, number>;
        wait: { recent: QueueWaitSummary; oldestPendingMs: number | null };
    } {
        const byPriority: Record<string, number> = {};
        let oldest: number | null = null;
        for (const e of this.pending) {
            byPriority[String(e.priority ?? 0)] = (byPriority[String(e.priority ?? 0)] ?? 0) + 1;
            if (e.enqueuedAt !== undefined && (oldest === null || e.enqueuedAt < oldest)) oldest = e.enqueuedAt;
        }
        const oldestPendingMs = oldest === null ? null : Math.max(0, this.now() - oldest);
        return { globalActive: this.globalActive, pending: this.pending.length, byPriority, wait: { recent: summarizeQueueWaits(this.recentWaits), oldestPendingMs } };
    }

    private canRun(userId: string): boolean {
        return this.globalActive < this.globalMax && (this.userActive.get(userId) ?? 0) < this.userMax;
    }

    private start(entry: QueueEntry): void {
        this.recordWait(Math.max(0, this.now() - (entry.enqueuedAt ?? this.now())));
        this.globalActive++;
        this.active.add(entry.taskId);
        this.userActive.set(entry.userId, (this.userActive.get(entry.userId) ?? 0) + 1);
        void entry.run()
            .catch((e) => logger.warn(`[Queue] 실행 thunk 예외(무시): ${entry.taskId} — ${e instanceof Error ? e.message : e}`))
            .finally(() => {
                this.active.delete(entry.taskId);
                this.globalActive = Math.max(0, this.globalActive - 1);
                const next = (this.userActive.get(entry.userId) ?? 1) - 1;
                if (next <= 0) this.userActive.delete(entry.userId);
                else this.userActive.set(entry.userId, next);
                this.drain();
                this.runReleaseRetry(entry.taskId);
            });
    }

    private recordWait(ms: number): void {
        this.recentWaits.push(ms);
        if (this.recentWaits.length > this.waitSampleSize) this.recentWaits.splice(0, this.recentWaits.length - this.waitSampleSize);
        getMetrics().recordHistogram(AGENT_TASK_QUEUE_WAIT_METRIC, ms);
    }

    /** 슬롯이 빈 만큼 대기열에서 꺼내 실행 — 유저 상한을 넘지 않는 후보 중 우선순위가 가장 높은 것, 같으면 먼저 등록된 것. */
    private drain(): void {
        while (this.globalActive < this.globalMax) {
            let best = -1;
            for (let i = 0; i < this.pending.length; i++) {
                const e = this.pending[i];
                if ((this.userActive.get(e.userId) ?? 0) >= this.userMax) continue; // 이 유저는 상한 도달
                if (best < 0 || (e.priority ?? 0) > (this.pending[best].priority ?? 0)) best = i;
            }
            if (best < 0) return;
            this.start(this.pending.splice(best, 1)[0]);
        }
    }
}

let queue: AgentTaskQueue | null = null;
export function getAgentTaskQueue(): AgentTaskQueue {
    if (!queue) queue = new AgentTaskQueue();
    return queue;
}

/**
 * PURE(설정 읽기): 요청 우선순위 → 큐 우선순위. 관리자는 [SCHEDULED, AGENT_TASK_QUEUE_PRIORITY_MAX], 그 외는 [SCHEDULED, DEFAULT].
 * 정수가 아니면 DEFAULT.
 */
export function resolveQueuePriority(requested: unknown, isAdmin: boolean, max: number = getConfig().agentTaskQueuePriorityMax): number {
    if (typeof requested !== 'number' || !Number.isInteger(requested)) return AGENT_TASK_LIMITS.QUEUE_PRIORITY_DEFAULT;
    const upper = isAdmin ? Math.max(AGENT_TASK_LIMITS.QUEUE_PRIORITY_DEFAULT, max) : AGENT_TASK_LIMITS.QUEUE_PRIORITY_DEFAULT;
    return Math.min(upper, Math.max(AGENT_TASK_LIMITS.QUEUE_PRIORITY_SCHEDULED, requested));
}

/**
 * 실행 디스패치 통합 진입점 — /execute·/resume·부팅복구가 공통 사용.
 * 큐 비활성(기본)이면 즉시 detached 발사(같은 작업이 아직 실행·종료 정리 중이면 'duplicate'). 활성이면 큐 제출 후 대기 시 'queued' 로 표기.
 */
export async function dispatchAgentTask(entry: QueueEntry): Promise<'started' | 'queued' | 'duplicate'> {
    if (!AGENT_TASK_LIMITS.QUEUE_ENABLED) return getAgentTaskQueue().runDirect(entry);
    const outcome = getAgentTaskQueue().submit(entry);
    // 우선순위도 남긴다 — 재시작으로 대기열이 증발해도 부팅 복구가 같은 순위로 다시 제출한다(131). 기본값은 컬럼 DEFAULT 와 같아 생략
    const priority = entry.priority && entry.priority !== AGENT_TASK_LIMITS.QUEUE_PRIORITY_DEFAULT ? { priority: entry.priority } : {};
    // duplicate 는 행을 건드리지 않는다 — 이 제출은 버려지므로 실행 중인 작업의 우선순위를 덮으면 안 되고, 호출부의 claim 되돌리기(updated_at 조건)도 깨진다
    if (outcome !== 'duplicate' && (outcome === 'queued' || 'priority' in priority)) {
        await getUnifiedDatabase().updateAgentTask(entry.taskId, { ...(outcome === 'queued' ? { status: 'queued' as const } : {}), ...priority }).catch(() => { /* noop */ });
    }
    return outcome;
}
