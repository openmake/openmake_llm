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

export const FOLD_MARKER = '[접힌 도구 결과]';

export interface FoldOptions {
    /** 원문을 유지할 최근 assistant 턴 수. */
    keepTurns: number;
    /** 이 길이 이하의 결과는 접지 않는다. */
    minChars: number;
    /** 스텁에 남기는 앞부분 길이. */
    headChars: number;
}

export interface FoldStats {
    /** 이번 호출에서 새로 접은 메시지 수. */
    folded: number;
    /** 새로 접어서 줄어든 글자 수(원문 − 스텁). */
    savedChars: number;
}

export function isFoldedToolResult(content: string): boolean {
    return content.startsWith(FOLD_MARKER);
}

function buildStub(toolName: string | undefined, original: string, headChars: number): string {
    const head = original.slice(0, headChars).replace(/\s+$/, '');
    const ellipsis = original.length > headChars ? '…' : '';
    return `${FOLD_MARKER} ${toolName ?? 'tool'} 결과 ${original.length}자 — 앞부분만 남김. `
        + '원문이 다시 필요하면 같은 도구를 다시 호출하세요.\n'
        + head + ellipsis;
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

    for (let i = 0; i < boundary; i++) {
        const m = conversation[i];
        if (m.role !== 'tool') continue;
        const content = typeof m.content === 'string' ? m.content : '';
        if (content.length <= opts.minChars || isFoldedToolResult(content)) continue;
        const stub = buildStub(m.tool_name, content, opts.headChars);
        if (stub.length >= content.length) continue; // 접어서 이득이 없으면 원문 유지
        m.content = stub;
        stats.folded++;
        stats.savedChars += content.length - stub.length;
    }
    return stats;
}
