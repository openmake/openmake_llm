/**
 * 대화 기록에서 실행이 끝난 도구 호출을 순서대로 꺼낸다 — 호출 인자(assistant.tool_calls)와 결과(tool 메시지)를 짝지은 것.
 * 상태를 따로 들고 다니지 않고 대화에서 읽으므로 재개(체크포인트 복원) 뒤에도 같은 답이 나온다.
 *
 * @module services/agent-task/tool-call-history
 */
import type { ChatMessage } from '../../llm/types';
import { FOLD_MARKER } from './context-fold';

export interface FinishedToolCall {
    name: string;
    args: Record<string, unknown>;
    /** 모델에 보인 결과 본문(접혔으면 스텁). */
    result: string;
    /** 결과가 오류였는가. */
    failed: boolean;
}

/** PURE: 결과가 오류인가 — 데이터 래퍼(<tool_output>)나 접힌 스텁(첫 줄이 안내)에 싸여 있어도 본다. */
function isFailedResult(content: string): boolean {
    const body = content.startsWith(FOLD_MARKER) ? content.slice(content.indexOf('\n') + 1) : content;
    return /^(?:<tool_output>\s*)?Error:/.test(body);
}

/** PURE: 결과가 붙은 호출만, 결과가 기록된 순서로. id 가 없는 호출은 짝지을 수 없어 뺀다. */
export function finishedToolCalls(conversation: readonly ChatMessage[]): FinishedToolCall[] {
    const pending = new Map<string, { name: string; args: Record<string, unknown> }>();
    const out: FinishedToolCall[] = [];
    for (const m of conversation) {
        if (m.role === 'assistant') {
            for (const tc of m.tool_calls ?? []) {
                if (tc.id) pending.set(tc.id, { name: tc.function.name, args: (tc.function.arguments ?? {}) as Record<string, unknown> });
            }
        } else if (m.role === 'tool' && m.tool_call_id && pending.has(m.tool_call_id)) {
            const result = typeof m.content === 'string' ? m.content : '';
            out.push({ ...pending.get(m.tool_call_id)!, result, failed: isFailedResult(result) });
        }
    }
    return out;
}
