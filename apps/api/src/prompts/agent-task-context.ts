/**
 * 에이전트 작업의 컨텍스트 관리 문구 — 접힌 스텁의 한 줄, 인계 요약, 큰 결과 보관 안내.
 * 모델에 보이는 문구만 둔다(판정·절단 규칙은 services/agent-task 쪽).
 *
 * @module prompts/agent-task-context
 */

/** 접힌 스텁 한 줄의 결과 표현. */
export const TOOL_DIGEST_OUTCOME = {
    ok: '성공',
    error: '오류',
    timeout: '시간 초과',
    noMatch: '일치 없음',
} as const;

/** 접힌 스텁 한 줄 — "도구 무엇 → 결과". detail 은 종료 코드·오류 줄 같은 덧붙임. */
export function getToolDigestLine(toolName: string, subject: string, outcome: string, detail?: string): string {
    return `${toolName} ${subject} → ${outcome}${detail ? ` (${detail})` : ''}`;
}

/** 인계 요약 메시지의 머리 표지 — 이 표지로 시작하는 user 메시지는 시스템이 만든 요약이다. */
export const HANDOFF_SUMMARY_MARKER = '[인계 요약]';

/** 인계 요약의 절 제목 — 앞선 요약을 이어받을 때 이 제목으로 절을 다시 읽는다. */
export const HANDOFF_SECTIONS = {
    request: '## 원래 요청',
    calls: '## 수행한 도구 호출 (오래된 순)',
    files: '## 관련 파일',
    errors: '## 오류',
} as const;

/** 인계 요약 첫 줄 — 정리했다는 사실과 이어서 할 일. */
export function getHandoffSummaryHeader(droppedMessages: number): string {
    return `${HANDOFF_SUMMARY_MARKER} 대화가 길어져 오래된 메시지 ${droppedMessages}개를 정리했습니다. `
        + '아래는 그 구간의 기록에서 그대로 뽑은 것입니다. 이미 한 일을 되풀이하지 말고 이어서 진행하세요.';
}

/** 목록이 상한을 넘어 앞쪽을 뺐을 때의 한 줄. */
export const HANDOFF_OMITTED_LINE = '- … 더 오래된 항목은 생략';

/** 요약에 싣는 도구 호출 한 줄 — 도구별 한 줄(tool-digest)이 없는 도구용. */
export function getHandoffGenericCall(toolName: string, failed: boolean, errorLine: string): string {
    return failed ? getToolDigestLine(toolName, '호출', TOOL_DIGEST_OUTCOME.error, errorLine) : getToolDigestLine(toolName, '호출', TOOL_DIGEST_OUTCOME.ok);
}

/**
 * 큰 도구 결과를 파일로 보관했을 때 미리보기 뒤에 붙이는 안내.
 * ⚠️ 도구를 "다시 호출하라"고 쓰지 않는다 — 같은 명령을 반복해 읽는 루프를 만든다(context-fold 의 2026-09-09 기록).
 * 보관 파일의 필요한 구간만 보게 한다.
 */
export function getToolResultSpillNotice(path: string, totalChars: number, totalLines: number, resumeLine: number): string {
    return `[전체 결과 보관] 위는 앞·뒤 미리보기입니다. 전체 ${totalChars}자(${totalLines}줄)는 ${path} 에 있습니다. `
        + `생략된 구간이 필요하면 str_replace_editor 의 command:view, path:"${path}", start_line:${resumeLine} 으로 필요한 만큼만 보세요.`;
}
