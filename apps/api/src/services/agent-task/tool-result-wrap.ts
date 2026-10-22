/**
 * 도구 결과 데이터 래퍼 — 외부에서 온 도구 결과(검색·MCP·browser)를 <tool_output> 으로 감싸고 뒤에 작업 목표를 다시 적는다.
 * 간접 프롬프트 주입 완화용이다. 모델에 보이는 대화 내용만 바꾸고, 스텝 기록·영수증·저널은 원문을 쓴다.
 * 켜고 끄는 것은 AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_ENABLED (운영 기본 ON(W3), dev/test OFF).
 * 출처(source)를 주면 여는 태그에 tool·server·url 속성을 싣는다 — 모델이 어느 도구·서버·주소에서 온 데이터인지 본다.
 *
 * @module services/agent-task/tool-result-wrap
 */
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { getAgentTaskToolResultReminder } from '../../prompts/agent-task-prompt';

/** 본문 안의 닫는 태그 — 그대로 두면 본문이 래퍼를 닫고 뒤 문장을 지시처럼 보이게 할 수 있다. */
const CLOSING_TAG = /<\s*\/\s*tool_output\s*>/gi;

/** 출처 태그 속성값 최대 글자 수(이스케이프 전) — 긴 URL·이름이 대화를 부풀리지 않게. */
export const TOOL_OUTPUT_ATTR_MAX_CHARS = 200;

/** 도구 결과의 출처 — 여는 태그 속성이 된다. 없는 값은 생략한다. */
export interface ToolOutputSource { tool: string; server?: string; url?: string }

/** PURE: 호출에서 출처 — 외부 MCP 도구(`서버::도구`)는 server, 인자의 문자열 url 은 url. */
export function toolOutputSource(name: string, args: Record<string, unknown>): ToolOutputSource {
    return {
        tool: name,
        server: name.includes('::') ? name.split('::')[0] : undefined,
        url: typeof args.url === 'string' ? args.url : undefined,
    };
}

/** PURE: 속성값 — 상한까지 자르고 & 를 먼저, 그다음 " < > 를 이스케이프한다(태그를 닫거나 속성을 끊지 못하게). */
function attrValue(value: string): string {
    return value.slice(0, TOOL_OUTPUT_ATTR_MAX_CHARS)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** PURE: 여는 태그 — source 가 없으면 종전과 같은 <tool_output>. */
function openingTag(source?: ToolOutputSource): string {
    if (!source) return '<tool_output>';
    const attrs = (['tool', 'server', 'url'] as const)
        .flatMap((k) => { const v = source[k]; return v ? [` ${k}="${attrValue(v)}"`] : []; })
        .join('');
    return `<tool_output${attrs}>`;
}

/** PURE: 결과를 데이터로 감싸고 뒤에 작업 목표(상한까지)를 다시 적는다. */
export function wrapUntrustedToolResult(text: string, goal: string, source?: ToolOutputSource): string {
    const body = text.replace(CLOSING_TAG, '<\\/tool_output>');
    const excerpt = goal.slice(0, AGENT_TASK_LIMITS.TOOL_RESULT_WRAP_GOAL_MAX_CHARS);
    return `${openingTag(source)}\n${body}\n</tool_output>\n${getAgentTaskToolResultReminder(excerpt)}`;
}
