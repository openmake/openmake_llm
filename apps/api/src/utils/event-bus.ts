/**
 * ============================================================
 * Event Bus — 프로세스 내 단일 EventEmitter
 * ============================================================
 *
 * 백그라운드 서비스(AgentTaskService 등)가 ws/HTTP 계층을 **참조하지 않고**
 * fire-and-forget 으로 진행상황을 발행 → ws 계층이 구독해 해당 user 에게 relay.
 * emit 은 리스너가 없어도 무해하므로 발행자는 누가 듣는지 신경 쓰지 않는다.
 *
 * ⚠️ in-process 전용 — PM2 **fork(단일 인스턴스)** 에서만 동작한다. cluster 모드에서는
 * worker 간 이벤트가 전달되지 않으므로(작업이 worker A, 사용자 소켓이 worker B) Redis
 * pub/sub 등으로 교체해야 한다. (현재 운영은 fork 단일 인스턴스 — project 운영 토폴로지)
 *
 * @module utils/event-bus
 */
import { EventEmitter } from 'events';

export const AGENT_TASK_PROGRESS = 'agent_task_progress';

/** 에이전트 작업 진행 이벤트 — 상태 전체를 실어 프론트가 GET 없이 카드 갱신 가능 */
export interface AgentTaskProgressEvent {
    /** 작업 소유자 userId — sendToUser 가 이 user 에게만 relay */
    userId: string;
    taskId: string;
    status: string;
    progress: number;
    currentTurn: number;
    /** 방금 기록된 스텝 요약(4-5) — 채팅 인라인 카드가 "현재 단계"를 실시간 표시. 선택적. */
    step?: { stepType: string; toolName?: string; preview?: string };
}

const bus = new EventEmitter();
bus.setMaxListeners(50);

export function getEventBus(): EventEmitter {
    return bus;
}

/** 진행상황 발행 (fire-and-forget). 리스너 없으면 무해. */
export function emitAgentTaskProgress(ev: AgentTaskProgressEvent): void {
    bus.emit(AGENT_TASK_PROGRESS, ev);
}
