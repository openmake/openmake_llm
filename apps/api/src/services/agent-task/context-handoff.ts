/**
 * 인계 요약 — 창 초과로 오래된 메시지를 버릴 때 그 자리에 남기는 짧은 요약 메시지.
 *
 * 종전에는 LLMClient 의 안전망(model-pool)이 요청 사본에서 오래된 메시지를 말없이 잘라냈다. 버렸다는
 * 표시도 요약도 없어, 모델은 이미 한 일을 모른 채 같은 일을 되풀이할 수 있었다.
 * 요약은 LLM 없이 기록에서 그대로 뽑는다: 사용한 도구 이름(전체), 원래 요청, 수행한 도구 호출(도구별 한 줄), 관련 파일 경로, 오류.
 * 원문은 agent_task_steps 에 그대로 남는다(대화만 줄인다).
 *
 * @module services/agent-task/context-handoff
 */
import { CONTEXT_HANDOFF, TOOL_DIGEST } from '../../config/agent-task-context';
import {
    HANDOFF_SUMMARY_MARKER, HANDOFF_SECTIONS, HANDOFF_OMITTED_LINE, HANDOFF_USED_TOOLS_PREFIX, TOOL_DIGEST_OUTCOME,
    getHandoffSummaryHeader, getHandoffGenericCall,
} from '../../prompts/agent-task-context';
import { foldedDigestOf, foldedHeadOf } from './context-fold';
import { digestToolCall, findToolCallArgs, toolErrorLine } from './tool-digest';
import type { ChatMessage } from '../../llm/types';

export function isHandoffSummary(content: string): boolean {
    return content.startsWith(HANDOFF_SUMMARY_MARKER);
}

/**
 * PURE: 인계 요약 본문에서 정리된 구간의 도구 이름을 읽는다(첫 절 앞의 "사용한 도구" 줄). 요약이 아니면 빈 목록.
 * 요약으로 바뀐 구간의 tool 메시지는 대화에서 사라지므로, 재개 때 사용 도구 복원은 이 줄에 기댄다.
 */
export function handoffUsedToolNames(content: string): string[] {
    if (!isHandoffSummary(content)) return [];
    for (const line of content.split('\n')) {
        if (line.startsWith('## ')) break;
        if (line.startsWith(HANDOFF_USED_TOOLS_PREFIX)) return line.slice(HANDOFF_USED_TOOLS_PREFIX.length).split(',').map((n) => n.trim()).filter(Boolean);
    }
    return [];
}

const ITEM = '- ';
const FAILED = [` → ${TOOL_DIGEST_OUTCOME.error}`, ` → ${TOOL_DIGEST_OUTCOME.timeout}`];

/** 앞선 요약의 한 절에서 항목(`- ` 줄)을 다시 읽는다. 생략 줄은 뺀다. */
function sectionItems(summary: string, title: string): string[] {
    const lines = summary.split('\n');
    const start = lines.indexOf(title);
    if (start < 0) return [];
    const items: string[] = [];
    for (let i = start + 1; i < lines.length && !lines[i].startsWith('## '); i++) {
        if (lines[i].startsWith(ITEM) && lines[i] !== HANDOFF_OMITTED_LINE) items.push(lines[i].slice(ITEM.length));
    }
    return items;
}

/** 최근 max 개만 남기고, 뺀 것이 있으면 맨 앞에 생략 줄을 둔다. */
function section(title: string, items: string[], max: number): string[] {
    if (items.length === 0) return [];
    const kept = items.slice(-max);
    return [title, ...(kept.length < items.length ? [HANDOFF_OMITTED_LINE] : []), ...kept.map((i) => `${ITEM}${i}`)];
}

/** 도구 결과 메시지 하나의 한 줄 — 접힌 스텁이면 실린 한 줄을, 아니면 인자와 결과에서 새로 만든다. */
function callLine(dropped: ChatMessage[], index: number): string {
    const m = dropped[index];
    const name = m.tool_name ?? 'tool';
    const body = foldedHeadOf(m.content);
    const err = toolErrorLine(body);
    return foldedDigestOf(m.content)
        ?? digestToolCall(m.tool_name, findToolCallArgs(dropped, index), body)
        ?? getHandoffGenericCall(name, err !== null, err ?? '');
}

/**
 * PURE: 버려지는 구간(dropped)에서 요약 본문을 만든다. 구간 안에 앞선 요약이 있으면 그 목록을 이어받는다.
 * request 는 대화의 첫 user 메시지(작업 목표).
 */
export function buildHandoffSummary(dropped: ChatMessage[], request: string): string {
    const calls: string[] = [];
    const files: string[] = [];
    const errors: string[] = [];
    const tools = new Set<string>();
    let messages = 0;
    dropped.forEach((m, i) => {
        if (m.role === 'user' && isHandoffSummary(m.content)) {
            for (const name of handoffUsedToolNames(m.content)) tools.add(name);
            calls.push(...sectionItems(m.content, HANDOFF_SECTIONS.calls));
            files.push(...sectionItems(m.content, HANDOFF_SECTIONS.files));
            errors.push(...sectionItems(m.content, HANDOFF_SECTIONS.errors));
            return;
        }
        messages++;
        if (m.role === 'assistant') {
            for (const tc of m.tool_calls ?? []) {
                if (!TOOL_DIGEST.FILE_TOOLS.includes(tc.function.name) && !TOOL_DIGEST.SHELL_TOOLS.includes(tc.function.name)) continue;
                for (const key of CONTEXT_HANDOFF.PATH_ARG_KEYS) {
                    const v = (tc.function.arguments ?? {})[key];
                    if (typeof v === 'string' && v.length > 0 && v !== '.') files.push(v);
                }
            }
        }
        if (m.role !== 'tool') return;
        if (m.tool_name) tools.add(m.tool_name);
        const line = callLine(dropped, i);
        calls.push(line);
        if (FAILED.some((f) => line.includes(f))) errors.push(line);
    });
    const uniqueFiles = files.filter((f, i) => files.lastIndexOf(f) === i);
    const req = request.replace(/\s+/g, ' ').trim().slice(0, CONTEXT_HANDOFF.REQUEST_MAX_CHARS);
    return [
        getHandoffSummaryHeader(messages),
        ...(tools.size > 0 ? [`${HANDOFF_USED_TOOLS_PREFIX}${[...tools].join(', ')}`] : []),
        ...(req ? [HANDOFF_SECTIONS.request, req] : []),
        ...section(HANDOFF_SECTIONS.calls, calls, CONTEXT_HANDOFF.MAX_CALLS),
        ...section(HANDOFF_SECTIONS.files, uniqueFiles, CONTEXT_HANDOFF.MAX_FILES),
        ...section(HANDOFF_SECTIONS.errors, errors, CONTEXT_HANDOFF.MAX_ERRORS),
    ].join('\n').slice(0, CONTEXT_HANDOFF.SUMMARY_MAX_CHARS);
}

/**
 * conversation 을 제자리에서 줄인다 — system 과 첫 user(목표)는 두고, 최근 메시지를 targetTokens 안에서
 * 뒤에서부터 남긴 뒤, 그 사이를 인계 요약 하나로 바꾼다. 줄일 것이 없으면 그대로 둔다.
 *
 *  - 남기는 구간이 tool 메시지로 시작하면 그 호출을 낸 assistant 까지 넓힌다(고아 tool 은 서버가 400).
 *  - 그래서 가장 최근 턴은 예산을 넘어도 통째로 남는다.
 *
 * estimate 는 메시지 묶음의 토큰 추정(호출부가 보정 계수를 곱해 넘긴다).
 */
export function compactWithHandoff(
    conversation: ChatMessage[], targetTokens: number, estimate: (messages: ChatMessage[]) => number,
): { dropped: number } {
    const head = conversation[0]?.role === 'system' ? 1 : 0;
    const anchor = conversation[head]?.role === 'user' && !isHandoffSummary(conversation[head].content) ? conversation[head] : null;
    const first = anchor ? head + 1 : head; // 여기부터가 버릴 수 있는 구간
    if (conversation.length - first < 2) return { dropped: 0 };
    if (estimate(conversation) <= targetTokens) return { dropped: 0 };

    // 요약 몫은 상한 글자 수만큼 떼어 둔다(한글은 글자당 1토큰 — 가장 큰 경우).
    const budget = targetTokens - estimate(conversation.slice(0, first)) - CONTEXT_HANDOFF.SUMMARY_MAX_CHARS;
    let keepFrom = conversation.length;
    let used = 0;
    for (let i = conversation.length - 1; i >= first; i--) {
        const t = estimate([conversation[i]]);
        if (used + t > budget && keepFrom < conversation.length) break;
        used += t;
        keepFrom = i;
    }
    while (keepFrom > first && conversation[keepFrom].role === 'tool') keepFrom--;

    const dropped = conversation.slice(first, keepFrom);
    // 버릴 것이 없거나 앞선 요약 하나뿐이면 바꿔도 줄지 않는다.
    if (dropped.every((m) => m.role === 'user' && isHandoffSummary(m.content))) return { dropped: 0 };
    const summary: ChatMessage = { role: 'user', content: buildHandoffSummary(dropped, anchor?.content ?? '') };
    conversation.splice(first, dropped.length, summary);
    return { dropped: dropped.length };
}
