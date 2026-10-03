/**
 * 한 턴의 도구 호출 가드 — 실행 전에 걸러낼 호출을 판정한다(turn-executor 에서 분리 — 파일 크기 가드).
 *
 * @module services/agent-task/turn-call-guards
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import { classifyToolRisk } from '../../config/tool-policy';
import { isReadOnlyTool } from '../tool-parallel';
import { hashApprovalArgs } from '../../data/repositories/agent-task-approval-repository';
import type { ToolCall } from '../../llm/types';

/**
 * PURE: 인자 JSON 이 깨져(출력 절단 등) {} 로 강등된 호출인가 — 실행하지 않고 오류 결과를 돌려준다.
 * 빈 인자로 실행하면 도구가 "필수 인자 없음"으로 실패하거나, 인자가 선택적인 도구는 엉뚱한 기본 동작을 한다.
 */
export function isRejectedCall(tc: ToolCall): boolean {
    return AGENT_TASK_TURN_LOOP.REJECT_MALFORMED_TOOL_ARGS && tc.argumentsInvalid === true;
}

/** PURE: 읽기·검색류 호출인가 — 위험 등급이 읽기(샌드박스 조회 도구)이거나, 병렬 선실행이 읽기 전용으로 보는 도구(web_search·외부 MCP 조회). */
function isReadCall(name: string, args: Record<string, unknown>): boolean {
    return classifyToolRisk(name, args) === 'read' || isReadOnlyTool(name);
}

/**
 * PURE: 한 응답 안에서 앞선 호출과 이름·인자가 같은 호출 → 그 앞선 호출. 읽기·검색류만 본다 —
 * 쓰기·셸·위임·질문·표에 없는 외부 도구는 두 번 부른 것이 의도일 수 있어 그대로 둔다. 인자가 깨진 호출은 대상이 아니다.
 * 종전에는 같은 검색 두 건이 둘 다 실행되고 검색 횟수도 두 번 올랐다.
 */
export function findDuplicateCalls(toolCalls: readonly ToolCall[]): Map<ToolCall, ToolCall> {
    const duplicates = new Map<ToolCall, ToolCall>();
    if (!AGENT_TASK_TURN_LOOP.DEDUPE_TOOL_CALLS) return duplicates;
    const first = new Map<string, ToolCall>();
    for (const tc of toolCalls) {
        const args = (tc.function.arguments ?? {}) as Record<string, unknown>;
        if (tc.argumentsInvalid || !isReadCall(tc.function.name, args)) continue;
        const key = `${tc.function.name}:${hashApprovalArgs(args)}`;
        const original = first.get(key);
        if (original) duplicates.set(tc, original);
        else first.set(key, tc);
    }
    return duplicates;
}
