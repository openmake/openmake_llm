/**
 * Agent Task 동시성 큐 (Phase 3-B) — reliability.
 *
 * `/execute`·`/resume`·부팅복구가 지금까지 detached 로 **즉시 발사**해 LLM 루프 동시 실행이
 * 무제한이었다(샌드박스 maxConcurrent 는 컨테이너만 제한). 스케줄(3-A)이 생기면 폭주한다.
 *
 * 이 큐는 전역·유저별 동시 실행 상한을 강제한다. 상한 초과 시 'queued' 로 대기시키고,
 * 실행 슬롯이 비면 FIFO(유저 상한 준수)로 dequeue 한다. 단일 프로세스 전제(API instances:1) —
 * 멀티프로세스 확장 시 Redis 백엔드가 필요(현재 범위 밖).
 *
 * @module services/agent-task/task-queue
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskQueue');

export interface QueueEntry {
    taskId: string;
    userId: string;
    /** 실제 실행 — AgentTaskService.execute 를 감싼 thunk. 절대 throw 하지 않음(execute 가 내부 흡수). */
    run: () => Promise<void>;
}

export class AgentTaskQueue {
    private globalActive = 0;
    private readonly userActive = new Map<string, number>();
    private readonly pending: QueueEntry[] = [];

    constructor(
        private readonly globalMax: number = AGENT_TASK_LIMITS.QUEUE_GLOBAL_MAX,
        private readonly userMax: number = AGENT_TASK_LIMITS.QUEUE_USER_MAX,
    ) {}

    /** 즉시 실행 가능하면 start('started'), 아니면 대기열 등록('queued'). */
    submit(entry: QueueEntry): 'started' | 'queued' {
        if (this.canRun(entry.userId)) {
            this.start(entry);
            return 'started';
        }
        this.pending.push(entry);
        logger.info(`[Queue] 대기 등록: ${entry.taskId} (대기 ${this.pending.length}, 실행 ${this.globalActive})`);
        return 'queued';
    }

    /** 대기 중인(아직 실행 전) task 를 취소로 제거. 실행 중이면 false(호출부가 AbortController 로 취소). */
    cancelPending(taskId: string): boolean {
        const i = this.pending.findIndex((e) => e.taskId === taskId);
        if (i < 0) return false;
        this.pending.splice(i, 1);
        return true;
    }

    /** 관측용 스냅샷. */
    stats(): { globalActive: number; pending: number } {
        return { globalActive: this.globalActive, pending: this.pending.length };
    }

    private canRun(userId: string): boolean {
        return this.globalActive < this.globalMax && (this.userActive.get(userId) ?? 0) < this.userMax;
    }

    private start(entry: QueueEntry): void {
        this.globalActive++;
        this.userActive.set(entry.userId, (this.userActive.get(entry.userId) ?? 0) + 1);
        void entry.run()
            .catch((e) => logger.warn(`[Queue] 실행 thunk 예외(무시): ${entry.taskId} — ${e instanceof Error ? e.message : e}`))
            .finally(() => {
                this.globalActive = Math.max(0, this.globalActive - 1);
                const next = (this.userActive.get(entry.userId) ?? 1) - 1;
                if (next <= 0) this.userActive.delete(entry.userId);
                else this.userActive.set(entry.userId, next);
                this.drain();
            });
    }

    /** 슬롯이 빈 만큼 대기열에서 유저 상한을 지키며 꺼내 실행. */
    private drain(): void {
        for (let i = 0; i < this.pending.length && this.globalActive < this.globalMax;) {
            const e = this.pending[i];
            if ((this.userActive.get(e.userId) ?? 0) < this.userMax) {
                this.pending.splice(i, 1);
                this.start(e);
                // splice 로 뒤 항목이 당겨졌으므로 i 유지(같은 인덱스 재검사).
            } else {
                i++; // 이 유저는 상한 도달 — 다음 후보로.
            }
        }
    }
}

let queue: AgentTaskQueue | null = null;
export function getAgentTaskQueue(): AgentTaskQueue {
    if (!queue) queue = new AgentTaskQueue();
    return queue;
}

/**
 * 실행 디스패치 통합 진입점 — /execute·/resume·부팅복구가 공통 사용.
 * 큐 비활성(기본)이면 기존대로 즉시 detached 발사. 활성이면 큐 제출 후 대기 시 'queued' 로 표기.
 */
export async function dispatchAgentTask(entry: QueueEntry): Promise<'started' | 'queued'> {
    if (!AGENT_TASK_LIMITS.QUEUE_ENABLED) {
        void entry.run().catch((e) => logger.warn(`[Queue] 실행 예외(무시): ${entry.taskId} — ${e instanceof Error ? e.message : e}`));
        return 'started';
    }
    const outcome = getAgentTaskQueue().submit(entry);
    if (outcome === 'queued') {
        await getUnifiedDatabase().updateAgentTask(entry.taskId, { status: 'queued' }).catch(() => { /* noop */ });
    }
    return outcome;
}
