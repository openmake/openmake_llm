/**
 * 실행 중 중간 지시(steering) 레지스트리 — 실행 중 task 에 사용자가 방향 지시를 주입하고,
 * AgentTaskService 루프가 매 턴 경계에서 drain 해 conversation 에 user 메시지로 반영한다.
 *
 * 구조: in-memory 싱글톤(ApprovalRegistry 패턴). task 백그라운드 프로세스가 drain() 으로 소비하고
 * REST(/steer)가 submit() 한다. 멀티프로세스 정합은 후속(현재 단일 워커 전제 — API instances:1).
 * 종료 시 clear() 로 잔존 방지(AgentTaskService finally). 프로세스 재시작 시 미소비분은 유실된다
 * (아직 conversation 에 반영되지 않았으므로 checkpoint 에도 없음 — 허용).
 *
 * @module services/agent-task/steering
 */
import type { ChatMessage } from '../../llm/types';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getAgentTaskSteeringInjection } from '../../prompts/agent-task-prompt';
import { createLogger } from '../../utils/logger';

const logger = createLogger('AgentTaskSteering');

/**
 * task 별 미소비 steering 메시지 큐(FIFO). 도착 순서대로 다음 턴 경계에서 주입된다.
 */
export class SteeringRegistry {
    private pending = new Map<string, string[]>();

    /** 미소비 지시를 추가. maxPending 초과 시 false(호출부가 429 처리). */
    submit(taskId: string, text: string, maxPending: number): boolean {
        const q = this.pending.get(taskId) ?? [];
        if (q.length >= maxPending) return false;
        q.push(text);
        this.pending.set(taskId, q);
        logger.info(`[${taskId}] steering 접수 (대기 ${q.length})`);
        return true;
    }

    /** 대기 중인 지시를 모두 반환하고 비운다(턴 경계 소비). 없으면 빈 배열. */
    drain(taskId: string): string[] {
        const q = this.pending.get(taskId);
        if (!q || q.length === 0) return [];
        this.pending.delete(taskId);
        return q;
    }

    /** 현재 대기 건수. */
    count(taskId: string): number {
        return this.pending.get(taskId)?.length ?? 0;
    }

    /** task 종료 시 잔존 지시 정리. */
    clear(taskId: string): void {
        this.pending.delete(taskId);
    }
}

let registry: SteeringRegistry | null = null;
export function getSteeringRegistry(): SteeringRegistry {
    if (!registry) registry = new SteeringRegistry();
    return registry;
}

/**
 * 턴 경계에서 대기 steering 을 소비 — conversation 에 user 메시지로 주입하고 step_type='steering'
 * 스텝을 영속 + WS emit. AgentTaskService 루프가 매 턴 상단에서 호출한다(파일 크기 가드로 분리).
 * 기능 OFF/대기 없음이면 stepNumber 그대로 반환. 스텝 기록 실패는 주입을 막지 않는다.
 */
export async function applyPendingSteering(
    taskId: string,
    turn: number,
    conversation: ChatMessage[],
    stepNumber: number,
    emit: (stepType: string, toolName?: string, content?: string | null) => void,
): Promise<number> {
    if (!AGENT_TASK_LIMITS.STEERING_ENABLED) return stepNumber;
    for (const text of getSteeringRegistry().drain(taskId)) {
        conversation.push({ role: 'user', content: getAgentTaskSteeringInjection(text) });
        await getUnifiedDatabase().addAgentTaskStep({
            taskId, stepNumber: stepNumber++, stepType: 'steering', content: text,
        }).catch(() => { /* 기록 실패는 주입을 막지 않음 */ });
        emit('steering', undefined, text);
        logger.info(`[${taskId}] steering 반영 (turn ${turn + 1})`);
    }
    return stepNumber;
}
