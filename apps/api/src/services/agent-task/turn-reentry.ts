/**
 * 턴 중간 재개(re-entry) + 턴 체크포인트 — Durable Task Runtime 1단계.
 *
 * 턴 중간 checkpoint(도구 결과 단위) 로 재개하면 conversation 의 마지막 assistant 메시지에
 * 결과(tool 메시지)가 없는 tool_call 이 남는다. 종전엔 그 상태로 LLM 을 다시 불러 ① 결과 없는
 * tool_call 이 대화에 매달리고 ② 이미 실행된 도구(bash·파일 쓰기)가 다시 실행됐다. 여기서는
 * 남은 호출만 골라 실행하되, 스텝 저널(agent_task_steps.tool_call_id, 124)에 결과가 있는 호출은
 * 재실행하지 않고 결과를 재사용한다.
 *
 * 한계(문서화): 도구가 끝났지만 스텝 행을 쓰기 전에 프로세스가 죽은 호출은 저널에 없어 다시
 * 실행된다 — 외부 부작용은 최소 1회 보장이다(정확히 1회는 도구 자체의 멱등성 문제).
 *
 * @module services/agent-task/turn-reentry
 */
import { getUnifiedDatabase, getPool } from '../../data/models/unified-database';
import { AgentTaskRepository } from '../../data/repositories/agent-task-repository';
import type { ChatMessage, ToolCall } from '../../llm/types';
import type { TaskRuntime } from '../task-sandbox/runtime';

export interface DanglingTurn {
    /** 결과가 아직 없는 tool_call 들(원래 순서). */
    calls: ToolCall[];
    /** 그 assistant 메시지의 본문 — terminate 경로의 rawContent 로 쓴다. */
    content: string;
}

/**
 * PURE: 마지막 assistant 메시지의 tool_calls 중 이어지는 tool 메시지가 없는 것들.
 * 마지막 assistant 이후에 user 메시지(nudge·steering)가 있으면 이미 다음 턴으로 넘어간
 * 것이므로 null.
 */
export function findDanglingToolCalls(conversation: ChatMessage[]): DanglingTurn | null {
    let i = conversation.length - 1;
    const answered = new Set<string>();
    for (; i >= 0; i--) {
        const m = conversation[i];
        if (m.role === 'tool') { if (m.tool_call_id) answered.add(m.tool_call_id); continue; }
        if (m.role === 'assistant') break;
        return null; // user/system 이 뒤에 있으면 턴이 이미 닫혔다
    }
    if (i < 0) return null;
    const calls = conversation[i].tool_calls ?? [];
    const remaining = calls.filter((tc) => tc.id === undefined || !answered.has(tc.id));
    if (remaining.length === 0) return null;
    return { calls: remaining, content: String(conversation[i].content ?? '') };
}

/** 저널 조회 — tool_call_id → 결과 본문. 행이 없으면 빈 Map(전부 실행). */
export async function loadToolCallJournal(taskId: string, calls: ToolCall[]): Promise<Map<string, string>> {
    const ids = calls.map((tc) => tc.id).filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) return new Map();
    return new AgentTaskRepository(getPool()).getToolCallJournal(taskId, ids);
}

/** end-of-turn 체크포인트 — 완전한 conversation + 완료 턴 + 계획 스냅샷(재개 시 복원). */
export async function writeTurnCheckpoint(taskId: string, conversation: ChatMessage[], completedTurn: number, taskRuntime: TaskRuntime | null): Promise<void> {
    const plan = taskRuntime?.getPlanSnapshot();
    await getUnifiedDatabase().updateAgentTask(taskId, {
        checkpoint: { conversation, completedTurn },
        ...(plan && plan.length > 0 ? { plan } : {}),
    });
}
