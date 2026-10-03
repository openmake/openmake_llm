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

/**
 * 검증 증거 원장 — 완료 관문의 workspace 테스트 게이트가 대화 기록을 보고 재실행 여부를 정한다.
 *   - 파일을 바꾼 흔적이 없으면(읽기만 한 작업, `ls` 만 한 bash) 게이트를 돌리지 않는다.
 *   - 마지막 변경 이후에 **게이트가 돌릴 것과 같은 테스트 실행**이 성공한 기록이 있으면 다시 돌리지 않는다.
 *     변경보다 오래된 기록은 낡은 것이다.
 * 증거로 치는 것은 좁다(FULL_TEST_RUN_RES): 작업 공간 루트에서, 게이트의 러너(npm·pytest·go)를, 대상을 고르는 인자 없이
 * 전체로 돌려 종료 코드 0 으로 끝난 명령뿐이다. 일부 테스트 실행·빌드·린트·다른 러너는 증거가 아니고, 감지된 러너가
 * 증거의 러너와 다르면 게이트를 그대로 돌린다(workspace-test-verify).
 * AGENT_TASK_VERIFY_EVIDENCE=true 로 켠다.
 */
export const VERIFY_EVIDENCE = {
    ENABLED: process.env.AGENT_TASK_VERIFY_EVIDENCE === 'true',
    /** 실행만으로 파일을 바꿨을 수 있다고 보는 도구(성공·실패 무관). bash 는 명령을 보고 가른다. */
    MUTATING_TOOLS: ['python_execute', 'skill_run', 'spawn_agents', 'delegate'] as readonly string[],
    /** 증거가 되는 명령 앞에 붙어도 되는 환경변수 — 실행 범위를 바꾸지 않는 것만(PYTEST_ADDOPTS 같은 것은 대상을 고른다). */
    EVIDENCE_ENV_RE: /^CI=\S+$/,
    /** 작업 공간 루트로 가는 cd. 다른 곳으로 간 뒤의 테스트는 게이트(루트에서 실행)와 범위가 달라 증거가 아니다. */
    ROOT_CD_RE: /^cd\s+(?:\/workspace\/?|\.\/?)$/,
} as const;

/** 테스트 게이트의 러너(workspace-test-verify 의 RUNNER_COMMANDS 와 같은 키). */
export type GateTestRunner = 'npm' | 'pytest' | 'go';

/**
 * 전체 실행 형태의 테스트 명령 — 한 토막 전체에 맞춘다(끝까지). 대상을 고르거나(-k, 경로, -run, `-- 인자`) 아무것도 돌리지 않을 수
 * 있는 인자(--collect-only, --if-present, --passWithNoTests)가 붙으면 맞지 않는다. 허용하는 것은 출력 모양만 바꾸는 인자다.
 */
export const FULL_TEST_RUN_RES: Readonly<Record<GateTestRunner, RegExp>> = {
    npm: /^(?:npm|pnpm|yarn)\s+(?:run\s+)?test(?:\s+(?:--silent|-s))*$/,
    pytest: /^(?:python3?\s+-m\s+)?pytest(?:\s+(?:-q+|-v+|-x|-s|-ra|--no-header|--tb=\w+|--color=\w+|-p\s+no:cacheprovider))*$/,
    go: /^go\s+test(?:\s+(?:-v|-count=1))*\s+\.\/\.\.\.$/,
};

/** 파일을 바꾸지 않는 셸 명령 — 한 토막의 앞머리에 맞춘다. 여기에 없으면 바꿨을 수 있다고 본다. */
export const READ_ONLY_COMMAND_RES: readonly RegExp[] = [
    /^(?:ls|cat|head|tail|grep|egrep|fgrep|rg|pwd|wc|echo|printf|which|file|stat|tree|du|df|date|whoami|cut|diff|cmp|test|\[|true|cd|nl|basename|dirname|realpath)\b/,
    /^env$/, // 인자가 붙은 env 는 다른 명령을 실행한다
    /^sort\b(?!.*\s(?:-o|--output)\b)/,
    /^uniq(?:\s+-\S+)*(?:\s+[^-\s]\S*)?$/, // 파일 인자가 둘이면 둘째는 출력 파일이다
    /^find\b(?!.*\s-(?:delete|exec|execdir|ok|fprint)\b)/,
    /^sed\s+-n\b(?!.*\s-i)/,
    /^git\s+(?:status|log|diff|show|branch|rev-parse|ls-files|blame|remote)\b/,
    /^(?:node|python3?|npm|go|cargo)\s+(?:-v|-V|--version|version)\b/,
];

/**
 * 구조화 질문 — ask_human 이 질문 여러 개와 선택지·권장안을 한 호출로 받는다(`questions`).
 * 문자열 하나짜리 호출(`question`)은 그대로 동작한다. 구조를 모르는 클라이언트(CLI·iOS)를 위해 서버가
 * 질문과 선택지를 줄글로 엮어 `question` 에도 넣는다.
 * AGENT_TASK_ASK_HUMAN_STRUCTURED=false 로 끄면 도구 스키마가 종전(question 하나)으로 돌아가고 questions 는 무시한다.
 */
export const ASK_HUMAN = {
    STRUCTURED_ENABLED: process.env.AGENT_TASK_ASK_HUMAN_STRUCTURED !== 'false',
    /** 한 호출에 받는 질문 수 상한 — 넘는 것은 버린다. */
    MAX_QUESTIONS: num(process.env.AGENT_TASK_ASK_HUMAN_MAX_QUESTIONS, 5),
    /** 질문 하나의 선택지 수 상한. */
    MAX_OPTIONS: num(process.env.AGENT_TASK_ASK_HUMAN_MAX_OPTIONS, 6),
    /** 선택지 한 개의 최대 글자 수. */
    OPTION_MAX_CHARS: 200,
} as const;
