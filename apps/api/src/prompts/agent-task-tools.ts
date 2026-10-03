/**
 * Agent Task 도구·실행 환경·완료 판정 보강 문구 (hermes-agent 검토 2단계, 2026-10-04).
 * 모델·사용자에게 보이는 문장만 둔다. 임계값·스위치는 config/agent-task-tools.ts.
 *
 * @module prompts/agent-task-tools
 */

/** str_replace — 차이를 무시하고 한 곳에 맞아 적용했다. 다음 편집이 파일의 실제 표기를 따르도록 알린다. */
export function getStrReplaceFuzzyAppliedNote(path: string, line: number, relaxed: string): string {
    return `치환 완료: ${path} (old_str 가 정확히 일치하지 않아 ${relaxed} 차이를 무시하고 ${line}번 줄에서 찾았습니다 — 유일하게 맞는 곳이라 적용했습니다)`;
}

/** str_replace — 차이를 무시하면 여러 곳에 맞는다. 적용하지 않는다. */
export function getStrReplaceAmbiguousMessage(path: string, relaxed: string, lines: readonly number[], total: number): string {
    return `old_str 가 정확히 일치하는 곳이 없고, ${relaxed} 차이를 무시하면 ${total}곳(${lines.join(', ')}번 줄${total > lines.length ? ' 등' : ''})에 맞습니다: ${path} — 적용하지 않았습니다. 앞뒤 줄을 더 넣어 한 곳만 가리키게 하세요.`;
}

/** str_replace — 어디에도 맞지 않는다. closest 는 "줄번호| 내용" 줄들(없으면 빈 배열). */
export function getStrReplaceNotFoundMessage(path: string, closest: readonly string[]): string {
    return closest.length > 0
        ? `old_str 를 찾을 수 없습니다: ${path} — 파일에서 가장 비슷한 줄:\n${closest.join('\n')}\n위 줄의 내용을 그대로 복사해 old_str 로 쓰세요(줄 번호와 "| " 는 빼고).`
        : `old_str 를 찾을 수 없습니다: ${path} — old_str 는 공백·들여쓰기까지 파일 내용과 정확히 일치해야 합니다. command:view 로 현재 내용을 확인한 뒤 그대로 복사해 쓰세요.`;
}

/** 단계 이름 — 안내 문구에 들어간다. */
export const STR_REPLACE_RELAXED_LABELS = {
    trailing: '줄 끝 공백',
    indent: '들여쓰기',
    quotes: '따옴표 종류',
    'indent+quotes': '들여쓰기·따옴표 종류',
} as const;
