/**
 * Agent Task 도구·실행 환경·완료 판정 보강 설정 (hermes-agent 검토 2단계, 2026-10-04).
 *
 * 문자열 치환의 단계적 매칭, 종료 코드 해석, 검색 무일치 원인 안내, 편집 후 문법 검사,
 * 검증 증거 원장, 파일 변경 실패 각주, 구조화 질문의 스위치와 임계값을 둔다.
 * 문구는 prompts/agent-task-tools.ts 에 있다.
 *
 * @module config/agent-task-tools
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

/**
 * str_replace 단계적 매칭 — 정확 일치가 0건일 때 줄 끝 공백 → 들여쓰기 → 따옴표 종류 순으로 차이를 무시하고
 * 다시 찾는다. 어느 단계든 **한 곳에만** 맞을 때 적용하고, 여러 곳에 맞으면 적용하지 않는다.
 * AGENT_TASK_STR_REPLACE_FUZZY=false 로 끄면 종전처럼 정확 일치만 한다(비슷한 줄 안내는 남는다).
 */
export const STR_REPLACE_MATCH = {
    FUZZY_ENABLED: process.env.AGENT_TASK_STR_REPLACE_FUZZY !== 'false',
    /** 실패 안내에 싣는 "비슷한 줄" 최대 개수. */
    CLOSEST_MAX_LINES: num(process.env.AGENT_TASK_STR_REPLACE_CLOSEST_MAX_LINES, 3),
    /** 비슷하다고 보는 최소 유사도(0~1, 글자 2-gram 겹침). 낮추면 무관한 줄이 섞인다. */
    CLOSEST_MIN_SIMILARITY: num(process.env.AGENT_TASK_STR_REPLACE_CLOSEST_MIN_SIMILARITY, 0.5),
    /** 안내에 싣는 한 줄의 최대 글자 수. */
    CLOSEST_LINE_MAX_CHARS: 200,
    /** 여러 곳에 맞았을 때 안내에 싣는 줄 번호 최대 개수. */
    AMBIGUOUS_MAX_LINES: 5,
} as const;

/** 같은 문자로 보는 따옴표 — 값(ASCII)으로 바꿔 비교한다. 글자 수가 그대로라 위치가 어긋나지 않는다. */
export const QUOTE_EQUIVALENTS: Readonly<Record<string, string>> = {
    '‘': "'", '’': "'", '“': "'", '”': "'", '"': "'",
};

/**
 * 종료 코드 해석 — 셸 결과에서 0 이 아닌 코드가 오류가 아닌 잘 알려진 경우.
 * 키는 명령 이름(경로는 떼고 본다) 또는 "명령 하위명령", 값은 코드 → 뜻(문구는 prompts/agent-task-tools 의 EXIT_CODE_NOTES).
 * 여러 명령을 &&·;·|| 로 이은 경우는 어느 명령의 코드인지 알 수 없어 해석하지 않는다. 파이프는 마지막 명령으로 본다.
 * 파이프로 가려진 실패 경고는 넣지 않았다 — 오탐이 더 많다.
 * AGENT_TASK_EXIT_CODE_HINT=false 로 끄면 종전처럼 0 이 아닌 코드는 모두 오류로 표시한다.
 */
export const EXIT_CODE_HINT_ENABLED = process.env.AGENT_TASK_EXIT_CODE_HINT !== 'false';

export type ExitCodeMeaning = 'no_match' | 'differ' | 'false';

const NO_MATCH: Readonly<Record<number, ExitCodeMeaning>> = { 1: 'no_match' };
const DIFFER: Readonly<Record<number, ExitCodeMeaning>> = { 1: 'differ' };
const FALSE: Readonly<Record<number, ExitCodeMeaning>> = { 1: 'false' };

export const EXIT_CODE_MEANINGS: Readonly<Record<string, Readonly<Record<number, ExitCodeMeaning>>>> = {
    grep: NO_MATCH, egrep: NO_MATCH, fgrep: NO_MATCH, rg: NO_MATCH, 'git grep': NO_MATCH,
    diff: DIFFER, cmp: DIFFER, 'git diff': DIFFER,
    test: FALSE, '[': FALSE, '[[': FALSE,
};

/**
 * 검색 무일치 원인 안내 — grep_code 가 0건일 때 대소문자, 이스케이프 안 된 정규식 문자, 숨김·무시 대상 파일을
 * 같은 검색을 조건만 바꿔 다시 돌려 확인하고, 처음 확인된 원인 하나를 결과 줄에 덧붙인다(확인당 결과 1줄만 읽는다).
 * AGENT_TASK_GREP_MISS_HINT=false 로 끄면 종전처럼 "일치 없음"만 준다.
 */
export const GREP_MISS_HINT_ENABLED = process.env.AGENT_TASK_GREP_MISS_HINT !== 'false';

/**
 * 편집 후 문법 검사 — 진단을 못 주는 실행기(Docker 샌드박스)에서 파일 쓰기 직후, 이미지에 이미 있는 인터프리터로
 * 문법만 본다(코드를 실행하지 않는다). 로컬 실행기는 자체 진단이 있어 대상이 아니다.
 * AGENT_TASK_EDIT_SYNTAX_CHECK=false 로 끈다.
 */
export const EDIT_SYNTAX_CHECK = {
    ENABLED: process.env.AGENT_TASK_EDIT_SYNTAX_CHECK !== 'false',
    /** 결과에 싣는 오류 출력의 최대 글자 수(끝부분을 남긴다 — 오류 줄이 끝에 있다). */
    REPORT_MAX_CHARS: num(process.env.AGENT_TASK_EDIT_SYNTAX_REPORT_MAX_CHARS, 600),
    /** 인터프리터가 없을 때의 셸 종료 코드 — 검사하지 못한 것으로 보고 넘어간다. */
    EXIT_NOT_FOUND: 127,
} as const;

/** 확장자 → 검사기. node·python 은 이미지에 있는 것만 쓴다(설치하지 않는다). json 은 서버에서 파싱한다. */
export const EDIT_SYNTAX_CHECKERS: Readonly<Record<string, 'node' | 'python' | 'json'>> = {
    js: 'node', mjs: 'node', cjs: 'node', py: 'python', json: 'json',
};

/**
 * 파일 변경 실패 각주 — 편집 도구(str_replace_editor·file_ops)의 쓰기가 실패했고 그 뒤로 같은 경로에 성공한
 * 기록이 없으면, 완료한 답변 뒤에 그 경로를 덧붙인다. 대화 기록에서 센다(재개 뒤에도 같다).
 * AGENT_TASK_WRITE_FAILURE_FOOTNOTE=false 로 끈다.
 */
export const WRITE_FAILURE_FOOTNOTE = {
    ENABLED: process.env.AGENT_TASK_WRITE_FAILURE_FOOTNOTE !== 'false',
    /** 각주에 적는 경로 최대 개수 — 넘으면 나머지는 개수로만 알린다. */
    MAX_PATHS: num(process.env.AGENT_TASK_WRITE_FAILURE_FOOTNOTE_MAX_PATHS, 10),
} as const;

/** 파일을 바꾸는 편집 호출 — 도구 이름 → { 동작을 담은 인자 이름, 파일을 바꾸는 동작 값 }. */
export const FILE_MUTATING_CALLS: Readonly<Record<string, { arg: string; values: readonly string[] }>> = {
    str_replace_editor: { arg: 'command', values: ['create', 'str_replace', 'insert'] },
    file_ops: { arg: 'op', values: ['write', 'delete'] },
};

/** 임의 코드를 실행하는 도구 — 인자에 실패한 경로가 나오고 성공했으면 그 경로를 다른 방법으로 고친 것으로 본다. */
export const CODE_EXEC_TOOLS: readonly string[] = ['bash', 'python_execute'];
