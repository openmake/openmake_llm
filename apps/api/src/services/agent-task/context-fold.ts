/**
 * Agent Task 오래된 도구 결과 접기 (context fold, 2026-09-06).
 *
 * 루프는 매 턴 conversation 전체를 다시 보내므로 비용이 턴 수에 O(n²) 로 붙는다. 30일 실측
 * (완료 44건): 평균 43.5만 토큰인데 스텝 본문 총량은 그 1/18 — 차이가 전부 재전송이다. 도구 결과
 * 절단(MAX_TOOL_RESULT_CHARS)은 발동률 2.2% 라 상한이 아니라 **누적 재전송**이 병목이다.
 *
 * 규칙(결정적, LLM 없음):
 *  - 최근 KEEP_TURNS 개 assistant 메시지에 속한 tool 결과는 원문 유지(모델이 방금 본 것).
 *  - 그보다 오래된 tool 결과 중 MIN_CHARS 초과분을 앞부분 HEAD_CHARS + 안내 한 줄의 스텁으로 치환.
 *  - 이미 접힌 스텁(FOLD_MARKER 로 시작)은 건너뛴다(멱등).
 *  - 원문은 agent_task_steps.tool_result 에 그대로 남아 있다(사후 분석·UI 무영향).
 *
 * ⚠️ 스텁의 앞부분(HEAD_CHARS)을 남기는 이유: goal judge 증거창(buildJudgeToolEvidence)이 최근
 * tool 결과 8개를 320자씩 읽는다 — 전부 지우면 판정 증거가 사라진다.
 *
 * @module services/agent-task/context-fold
 */
import type { ChatMessage } from '../../llm/types';
import { runCompactionHooks } from './compaction-hooks';
import { digestToolCall, findToolCallArgs } from './tool-digest';
import { CONTEXT_FOLD_BATCH } from '../../config/agent-task-context';
import { getFoldedSpillRef, spilledResultPathOf } from '../../prompts/agent-task-context';

export const FOLD_MARKER = '[접힌 도구 결과]';

interface FoldOptions {
    /** 원문을 유지할 최근 assistant 턴 수. */
    keepTurns: number;
    /** 이 길이 이하의 결과는 접지 않는다. */
    minChars: number;
    /** 스텁에 남기는 앞부분 길이. */
    headChars: number;
    /** 이번에 새로 접어 회수할 글자 수가 이보다 적으면 접지 않는다(묶음). 생략하면 설정값(기본 0 = 매번 접음). */
    minBatchSavedChars?: number;
}

interface FoldStats {
    /** 이번 호출에서 새로 접은 메시지 수. */
    folded: number;
    /** 새로 접어서 줄어든 글자 수(원문 − 스텁). */
    savedChars: number;
}

export function isFoldedToolResult(content: string): boolean {
    return content.startsWith(FOLD_MARKER);
}

/** 스텁 첫 줄에서 한 줄 요약과 나머지 안내를 가르는 표지 — foldedDigestOf 가 이 앞까지를 읽는다. */
const DIGEST_SEPARATOR = ' · 결과 ';

function buildStub(toolName: string | undefined, original: string, headChars: number, digest: string | null): string {
    const head = original.slice(0, headChars).replace(/\s+$/, '');
    const ellipsis = original.length > headChars ? '…' : '';
    const spilled = spilledResultPathOf(original);
    // ⚠️ "원문이 필요하면 다시 호출하세요" 류 문구 금지 — 2026-09-09 실측(10770ab5): 그 문구가
    // 같은 파일을 25턴 동안 반복해 읽는 루프를 유도했다(접힌 구간을 매번 다시 읽고 또 접힘).
    // 이미 처리한 내용임을 알리고, 필요한 요점은 메모로 남기게 한다.
    return `${FOLD_MARKER} ${digest ? `${digest}${DIGEST_SEPARATOR}` : `${toolName ?? 'tool'} 결과 `}${original.length}자 — 이미 읽고 처리한 내용이라 앞부분만 남김. `
        + '같은 내용을 다시 읽지 마세요. 나중에 필요한 요점은 지금 메모 파일(예: notes.md)에 적어 두세요.'
        // 파일로 보관한 결과(tool-result-spill)는 경로를 남긴다 — 안내가 미리보기 끝에 있어 접으면 사라진다.
        + (spilled ? getFoldedSpillRef(spilled) : '') + '\n'
        + head + ellipsis;
}

/** PURE: 접힌 스텁에 실린 도구별 한 줄(tool-digest). 스텁이 아니거나 한 줄이 없으면 null. */
export function foldedDigestOf(content: string): string | null {
    if (!isFoldedToolResult(content)) return null;
    const first = content.split('\n', 1)[0];
    const at = first.lastIndexOf(DIGEST_SEPARATOR);
    return at < 0 ? null : first.slice(FOLD_MARKER.length, at).trim();
}

/** PURE: 접힌 스텁에 남은 원문 앞부분(안내 줄 다음). 스텁이 아니면 원문 그대로. */
export function foldedHeadOf(content: string): string {
    if (!isFoldedToolResult(content)) return content;
    const nl = content.indexOf('\n');
    return nl < 0 ? '' : content.slice(nl + 1);
}

/**
 * conversation 을 제자리에서 접는다. 반환값은 관측용 통계.
 * 턴 경계는 assistant 메시지로 센다(도구 결과는 직전 assistant 의 tool_calls 에 속한다).
 */
export function foldOldToolResults(conversation: ChatMessage[], opts: FoldOptions): FoldStats {
    const stats: FoldStats = { folded: 0, savedChars: 0 };
    if (opts.keepTurns < 0 || conversation.length === 0) return stats;

    // 뒤에서부터 keepTurns 번째 assistant 의 인덱스 — 그 assistant(와 그 턴의 tool 결과)까지는 유지하고,
    // 그 앞의 tool 메시지가 접기 대상. keepTurns 0 은 경계를 못 잡아 접지 않는다(사실상 비활성).
    let assistantsSeen = 0;
    let boundary = conversation.length; // 이 인덱스 미만이 "오래된" 영역
    for (let i = conversation.length - 1; i >= 0; i--) {
        if (conversation[i].role !== 'assistant') continue;
        assistantsSeen++;
        if (assistantsSeen === opts.keepTurns) { boundary = i; break; }
    }
    if (boundary === conversation.length) return stats; // 아직 keepTurns 만큼의 턴이 없다

    // 먼저 접을 대상을 모으고, 회수량이 묶음 임계에 못 미치면 이번 턴에는 과거 메시지를 고치지 않는다
    // (접두 캐시 보호 — 조금 줄이려고 매 턴 과거를 바꾸면 그 뒤 전부가 캐시에서 빠진다).
    const pending: Array<{ index: number; stub: string; saved: number }> = [];
    for (let i = 0; i < boundary; i++) {
        const m = conversation[i];
        if (m.role !== 'tool') continue;
        const content = typeof m.content === 'string' ? m.content : '';
        if (content.length <= opts.minChars || isFoldedToolResult(content)) continue;
        // 도구별 한 줄(무엇을 했고 결과가 어땠나) — 접힌 뒤에도 명령과 성패가 남는다(tool-digest).
        const stub = buildStub(m.tool_name, content, opts.headChars, digestToolCall(m.tool_name, findToolCallArgs(conversation, i), content));
        if (stub.length >= content.length) continue; // 접어서 이득이 없으면 원문 유지
        pending.push({ index: i, stub, saved: content.length - stub.length });
    }
    const reclaim = pending.reduce((n, p) => n + p.saved, 0);
    if (reclaim < (opts.minBatchSavedChars ?? CONTEXT_FOLD_BATCH.MIN_SAVED_CHARS)) return stats;
    for (const p of pending) conversation[p.index].content = p.stub;
    stats.folded = pending.length;
    stats.savedChars = reclaim;
    if (stats.folded > 0) runCompactionHooks({ conversation, folded: stats.folded, savedChars: stats.savedChars });
    return stats;
}
