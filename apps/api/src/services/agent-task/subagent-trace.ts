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
/** `queued`/`started` 는 수명 마킹(활동 아님) — 이 둘이 없으면 아직 첫 도구를 부르지 않은 서브는
 *  테이블에 행이 없어 진행 화면에 존재조차 하지 않는다("대기 중"·"실행 중"을 표현할 수 없음). */
export type SubagentStepType = 'queued' | 'started' | 'tool_call' | 'tool_result' | 'final' | 'error';

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

    /** fan-out 등록 — 실행 슬롯을 기다리는 동안에도 목록에 보이도록 서브목표를 남긴다. */
    queued(subgoal: string): void {
        this.record('queued', subgoal);
    }

    /** 실행 진입 — queued 와 갈라져야 "대기 중"과 "실행 중"이 구분된다. */
    started(): void {
        this.record('started', '');
    }
}

/** PURE: 서브에이전트 표시 라벨 — role/agentId 가 없으면 서브목표 앞부분으로 대신한다.
 *  (라벨이 비면 진행 목록이 "서브 1·서브 2"로만 남아 무엇을 시키는지 알 수 없다.) */
export function subagentLabel(explicit: string | null | undefined, subgoal: string): string | null {
    const named = explicit?.trim();
    if (named) return named;
    const text = subgoal.trim().replace(/\s+/g, ' ');
    if (!text) return null;
    const max = AGENT_TASK_LIMITS.SUBAGENT_LABEL_MAX_CHARS;
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
