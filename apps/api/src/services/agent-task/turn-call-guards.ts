/**
 * 한 턴의 도구 호출 가드 — 실행 전에 걸러낼 호출을 판정한다(turn-executor 에서 분리 — 파일 크기 가드).
 *
 * @module services/agent-task/turn-call-guards
 */
import { AGENT_TASK_TURN_LOOP } from '../../config/agent-task-turn-loop';
import type { ToolCall } from '../../llm/types';

/**
 * PURE: 인자 JSON 이 깨져(출력 절단 등) {} 로 강등된 호출인가 — 실행하지 않고 오류 결과를 돌려준다.
 * 빈 인자로 실행하면 도구가 "필수 인자 없음"으로 실패하거나, 인자가 선택적인 도구는 엉뚱한 기본 동작을 한다.
 */
export function isRejectedCall(tc: ToolCall): boolean {
    return AGENT_TASK_TURN_LOOP.REJECT_MALFORMED_TOOL_ARGS && tc.argumentsInvalid === true;
}
