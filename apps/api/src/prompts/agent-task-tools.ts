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

/** 종료 코드 해석 — 셸 결과의 [exit=N] 줄 바로 뒤에 붙는다. 키는 config 의 ExitCodeMeaning. */
export const EXIT_CODE_NOTES = {
    no_match: '(종료 코드 1 = 일치 없음 — 오류가 아닙니다)',
    differ: '(종료 코드 1 = 차이 있음 — 오류가 아닙니다)',
    false: '(종료 코드 1 = 조건이 거짓 — 오류가 아닙니다)',
} as const;

/** 파이프에 가려진 실패 — 셸 결과의 [exit=0] 줄 바로 뒤에 한 줄로 붙는다. failed 는 0 이 아닌 코드로 끝난 앞 단계들. */
export function getMaskedPipeFailureNote(failed: ReadonlyArray<{ index: number; command: string; exitCode: number }>): string {
    const list = failed.map((f) => `${f.index}번째(\`${f.command}\`)가 종료 코드 ${f.exitCode}`).join(', ');
    return `(주의: 파이프라인의 앞 명령 ${list} 로 끝났습니다 — 전체 종료 코드 0 은 마지막 명령의 것입니다. 앞 명령의 출력을 확인하세요)`;
}

/** 검색 무일치 원인 — "(일치 없음: …)" 바로 뒤에 같은 줄로 붙는다. */
export const GREP_MISS_HINTS = {
    ignoreCase: () => ' — 대소문자를 무시하면 일치하는 줄이 있습니다. ignore_case:true 로 다시 찾으세요.',
    literal: (escaped: string) => ` — 패턴의 정규식 문자를 문자 그대로 보면 일치하는 줄이 있습니다. 이스케이프해서 다시 찾으세요: ${escaped}`,
    hidden: (file: string) => ` — 숨김 또는 .gitignore 대상 파일에는 일치하는 줄이 있습니다(예: ${file}). 그 파일이나 폴더를 path 로 지목해 다시 찾으세요.`,
} as const;

/** 편집 후 문법 검사 — 쓰기 결과 뒤에 붙는다. tool 은 검사한 도구 이름, report 는 오류 출력 끝부분. */
export function getEditSyntaxErrorNote(path: string, tool: string, report: string): string {
    return `[문법 오류 — 방금 쓴 ${path} 가 ${tool} 문법 검사를 통과하지 못했습니다. 파일은 저장됐습니다. 다음 작업 전에 고치세요]\n${report}`;
}

/** 파일 변경 실패 각주 — 완료한 답변 뒤에 붙는다. rest 는 상한을 넘어 적지 못한 경로 수. */
export function getWriteFailureFootnote(paths: readonly string[], rest: number): string {
    return `---\n참고: 다음 파일은 변경을 시도했지만 실패했고, 그 뒤로 성공한 기록이 없습니다 — ${paths.join(', ')}${rest > 0 ? ` 외 ${rest}개` : ''}`;
}

/** 검증 증거 원장 — 테스트 게이트를 돌리지 않은 이유(진행 표시·로그). */
export const VERIFY_EVIDENCE_SKIP_NOTES = {
    no_change: () => '테스트 게이트: 파일을 바꾼 기록이 없어 돌리지 않음',
    fresh_pass: (command: string) => `테스트 게이트: 마지막 변경 이후 통과한 전체 테스트 실행 기록이 있어 다시 돌리지 않음 (${command})`,
} as const;

/** ask_human 도구 설명·인자 설명(구조화 질문). 기본 설명 뒤에 붙는다. */
export const ASK_HUMAN_STRUCTURED_DESCRIPTION =
    ' 질문이 하나면 question 을, 여러 개이거나 고를 선택지가 있으면 questions 를 쓰세요 — 따로따로 여러 번 묻지 말고 한 번에 모아 물으세요.';
export const ASK_HUMAN_ARG_DESCRIPTIONS = {
    question: '사용자에게 물을 질문(하나일 때). questions 와 함께 쓰면 질문들 앞의 설명이 됩니다',
    questions: '질문 목록 — 여러 개를 한 번에 묻거나 선택지를 줄 때',
    itemQuestion: '질문 문장',
    options: '사용자가 고를 선택지(짧은 문구). 사용자는 선택지 밖의 답을 글로 쓸 수도 있습니다',
    recommended: '권장하는 선택지 — options 중 하나와 같은 문구',
} as const;

/** 구조를 모르는 클라이언트와 모델 결과에 쓰는 줄글 — 질문 한 줄에 선택지와 권장안을 덧붙인다. */
export function formatAskHumanLine(question: string, options: readonly string[], recommended: string | undefined, index: number | null): string {
    const head = index === null ? question : `${index}) ${question}`;
    if (options.length === 0) return head;
    return `${head} — 선택지: ${options.join(' / ')}${recommended ? ` (권장: ${recommended})` : ''}`;
}
