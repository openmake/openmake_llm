/**
 * 서브에이전트 활동 기록기 — runSubagent 가 턴마다 부른다(선택 인자, 없으면 무기록).
 *
 * 실패해도 서브를 죽이지 않는다(fail-open) — 기록은 관측이지 실행의 일부가 아니다. 대신
 * 실패는 warn 으로 남겨 "기록이 없는데 정상"과 구분한다.
 *
 * @module services/agent-task/subagent-trace
 */
import { randomUUID } from 'crypto';
import { getUnifiedDatabase } from '../../data/models/unified-database';
import { AgentTaskSubagentStepRepository } from '../../data/repositories/agent-task-subagent-step-repository';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SubagentTrace');

export type SubagentOrigin = 'spawn_agents' | 'delegate';
export type SubagentStepType = 'tool_call' | 'tool_result' | 'final' | 'error';

/** fan-out/위임 1회를 묶는 id — 같은 fan-out 의 서브들은 trace_id 를 공유하고 sub_index 로 갈린다. */
export function newTraceId(): string {
    return randomUUID();
}

export class SubagentTrace {
    private seq = 0;
    private readonly repo = new AgentTaskSubagentStepRepository(getUnifiedDatabase().getPool());

    constructor(
        private readonly taskId: string,
        private readonly traceId: string,
        private readonly origin: SubagentOrigin,
        private readonly subIndex: number,
        private readonly label: string | null,
    ) {}

    /** 기록(비동기, 대기하지 않음). 본문은 상한으로 자른다 — 도구 결과 전문이 두 번 저장되는 것 방지. */
    record(stepType: SubagentStepType, content: string, toolName?: string): void {
        if (!AGENT_TASK_LIMITS.SUBAGENT_TRACE_ENABLED) return;
        const cap = AGENT_TASK_LIMITS.SUBAGENT_TRACE_CONTENT_CAP;
        const text = content.length > cap ? `${content.slice(0, cap)}\n...[${content.length}자 중 앞부분]` : content;
        const seq = this.seq++;
        void this.repo.add({
            task_id: this.taskId, trace_id: this.traceId, origin: this.origin, sub_index: this.subIndex,
            label: this.label, seq, step_type: stepType, tool_name: toolName ?? null, content: text,
        }).catch((e) => logger.warn(`서브에이전트 스텝 기록 실패 (${this.taskId}/${this.subIndex}#${seq}): ${e instanceof Error ? e.message : e}`));
    }
}
