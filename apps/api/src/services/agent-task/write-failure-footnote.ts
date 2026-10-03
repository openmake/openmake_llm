/**
 * 파일 변경 실패 각주 — 실패한 쓰기를 경로별로 따져, 끝까지 성공하지 못한 경로만 완료한 답변 뒤에 덧붙인다.
 *
 * 종전에는 쓰기 실패가 도구 결과 문자열로만 돌아가, 모델이 그것을 놓치고 "수정했습니다"로 끝내면 사용자는
 * 어느 파일이 안 바뀌었는지 알 수 없었다. 경로마다 마지막 쓰기 결과를 보고, 실패로 끝난 것만 알린다.
 * 실패 뒤에 셸·파이썬이 그 경로를 다루고 성공했으면 다른 방법으로 고친 것으로 보고 뺀다(틀린 경고를 줄이는 쪽).
 * 결정적 규칙이다(LLM 호출 없음).
 *
 * @module services/agent-task/write-failure-footnote
 */
import type { ChatMessage } from '../../llm/types';
import { CODE_EXEC_TOOLS, FILE_MUTATING_CALLS, WRITE_FAILURE_FOOTNOTE } from '../../config/agent-task-tools';
import { getWriteFailureFootnote } from '../../prompts/agent-task-tools';
import { finishedToolCalls } from './tool-call-history';

/** PURE: 실패한 뒤 성공한 기록이 없는 경로 — 처음 실패한 순서대로. */
export function unresolvedWriteFailures(conversation: readonly ChatMessage[]): string[] {
    const failed = new Set<string>();
    for (const c of finishedToolCalls(conversation)) {
        const rule = FILE_MUTATING_CALLS[c.name];
        if (rule) {
            const path = typeof c.args.path === 'string' ? c.args.path.replace(/^\.\//, '') : '';
            if (!path || !rule.values.includes(String(c.args[rule.arg]))) continue;
            if (c.failed) failed.add(path); else failed.delete(path);
        } else if (CODE_EXEC_TOOLS.includes(c.name) && !c.failed && failed.size > 0) {
            const text = JSON.stringify(c.args);
            for (const path of [...failed]) if (text.includes(path)) failed.delete(path);
        }
    }
    return [...failed];
}

/** PURE: 남은 실패가 있으면 본문 뒤에 각주를 붙인다. */
export function withWriteFailureFootnote(
    body: string, conversation: readonly ChatMessage[] | undefined,
    enabled: boolean = WRITE_FAILURE_FOOTNOTE.ENABLED,
): string {
    if (!enabled || !conversation) return body;
    const paths = unresolvedWriteFailures(conversation);
    if (paths.length === 0) return body;
    const shown = paths.slice(0, WRITE_FAILURE_FOOTNOTE.MAX_PATHS);
    return `${body}\n\n${getWriteFailureFootnote(shown, paths.length - shown.length)}`;
}
