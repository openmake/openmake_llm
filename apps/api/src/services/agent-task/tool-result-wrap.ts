/**
 * 도구 결과 데이터 래퍼 — 외부에서 온 도구 결과(검색·MCP·browser)를 <tool_output> 으로 감싸고 뒤에 작업 목표를 다시 적는다.
 * 간접 프롬프트 주입 완화용이다. 모델에 보이는 대화 내용만 바꾸고, 스텝 기록·영수증·저널은 원문을 쓴다.
 * 켜고 끄는 것은 AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_ENABLED (기본 OFF).
 *
 * @module services/agent-task/tool-result-wrap
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getAgentTaskToolResultReminder } from '../../prompts/agent-task-prompt';

/** 본문 안의 닫는 태그 — 그대로 두면 본문이 래퍼를 닫고 뒤 문장을 지시처럼 보이게 할 수 있다. */
const CLOSING_TAG = /<\s*\/\s*tool_output\s*>/gi;

/** PURE: 결과를 데이터로 감싸고 뒤에 작업 목표(상한까지)를 다시 적는다. */
export function wrapUntrustedToolResult(text: string, goal: string): string {
    const body = text.replace(CLOSING_TAG, '<\\/tool_output>');
    const excerpt = goal.slice(0, AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_GOAL_MAX_CHARS);
    return `<tool_output>\n${body}\n</tool_output>\n${getAgentTaskToolResultReminder(excerpt)}`;
}
