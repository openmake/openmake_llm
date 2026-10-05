/**
 * 에이전트 작업 승인(HITL) 보강 설정 — 거절 사유·저장본 가림·자동승인의 바닥·무인 실행의 결론.
 * 승인 정책 자체(all/high-risk/none)와 위험 등급표는 `config/task-sandbox`·`config/tool-policy` 에 있다.
 *
 * @module config/agent-task-approval
 */

/** 거절 사유 상한(자) — 넘으면 앞에서 자른다(거절 자체는 막지 않는다). AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS */
export const APPROVAL_REJECT_REASON_MAX_CHARS = parseInt(process.env.AGENT_TASK_APPROVAL_REJECT_REASON_MAX_CHARS || '', 10) || 500;

/**
 * 승인 저장본(승인함에 보이는 인자·미리보기 사본)의 비밀 값 가림 — 기본 켜짐.
 * 실행과 호출 결속은 원래 인자를 쓰므로 가려도 달라지지 않는다. AGENT_TASK_APPROVAL_REDACT_ARGS=false 로 끈다.
 */
export const APPROVAL_REDACT_STORED_ARGS = process.env.AGENT_TASK_APPROVAL_REDACT_ARGS !== 'false';

/**
 * 승인 저장본의 키 이름 판정 낱말 — 키 이름을 낱말(스네이크·케밥·카멜 분해)로 보고 비밀을 뜻할 때만 가린다.
 * 조각 일치(`keywords`·`max_tokens`·브라우저 `key: "Enter"` 까지 가림)로는 사용자가 승인할 내용을 못 본다.
 * 스텝 기록의 마스킹(agent-task/tool-args)은 사람이 읽고 결정하는 사본이 아니라 종전의 넓은 기준 그대로다.
 */
export const APPROVAL_SECRET_KEY_WORDS = {
    /** 낱말 안에 들어 있기만 해도 비밀(붙여 쓴 `clientsecret`·`apikey` 포함). */
    stems: ['password', 'passwd', 'passphrase', 'secret', 'credential', 'authorization', 'cookie', 'apikey', 'privatekey', 'accesskey', 'sessionid'],
    /** 낱말 전체가 같을 때만 비밀 — `author`·`oauth_provider` 같은 이름과 구분한다. */
    exact: ['pwd', 'auth'],
    /** `session` 은 단독이거나 이 낱말과 함께일 때만 비밀(`session_name`·`session_timeout` 은 남긴다). */
    sessionWith: ['id', 'token', 'key', 'cookie'],
    /** `token(s)` 옆에 있으면 수량·종류·페이지 표식이라 비밀이 아니다. 값이 숫자·불리언일 때도 남긴다. */
    tokenPlain: ['max', 'min', 'count', 'limit', 'budget', 'usage', 'used', 'num', 'number', 'total', 'estimate', 'estimated', 'remaining',
        'input', 'output', 'prompt', 'completion', 'per', 'size', 'length', 'type', 'page', 'next', 'prev', 'continuation'],
    /** `key(s)` 옆에 있으면 정렬·조회용 이름이라 비밀이 아니다. 그 밖의 `*_key` 는 가린다(모르는 서비스의 키일 수 있다). */
    keyPlain: ['sort', 'order', 'primary', 'foreign', 'partition', 'cache', 'idempotency', 'dedupe', 'lookup', 'object', 'row', 'group',
        'field', 'column', 'index', 'name', 'names', 'id', 'type', 'code', 'press', 'pressed', 'keyboard', 'hot', 'shortcut', 'path', 'file'],
    /** 단독 `key`·`keys` 의 값이 이 이름(또는 한 글자·F1~F24)을 `+` 로 이은 것이면 키보드 입력이라 남긴다. */
    keyboardKeys: ['enter', 'return', 'tab', 'escape', 'esc', 'backspace', 'delete', 'insert', 'space', 'home', 'end', 'pageup', 'pagedown',
        'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'up', 'down', 'left', 'right', 'control', 'ctrl', 'shift', 'alt', 'meta', 'cmd',
        'command', 'option', 'controlormeta', 'capslock'],
} as const;

/**
 * 자동승인의 바닥 — 작업의 "나머지 모두 승인"에서도 계속 묻는 호출 종류.
 *   credential_write  자격증명 파일(SENSITIVE_FILE_PATTERNS)을 만들거나 고치거나 지우는 호출
 *   third_party_tool  외부 MCP 서버 도구(`server::tool`) — 제3자 코드가 호스트 밖으로 나간다
 *   instruction_write 에이전트 지시 파일(아래 INSTRUCTION_FILE_PATTERNS)을 만들거나 고치거나 지우는 호출
 *   memory_write      사용자 메모리에 쓰는 호출(memory_save) — 다음 대화·작업의 프롬프트에 계속 실린다
 *   site_write        로컬 브라우저로 허용 목록 밖 사이트에 입력·누르기를 하는 호출 — 내용이 OpenMake 밖으로 나간다(Companion P2).
 *                     memory_write 처럼 정책 none 에서도 묻는다
 * 바닥 검사는 자동승인보다 먼저 돈다. 승인 정책 none(승인 자체가 없음)에는 적용되지 않는다 — memory_write 만 예외로
 * 정책 none 에서도 묻는다(approval-gate 의 requiresApproval). memory_write 를 바닥에서 빼면 memory_save 도구는 실리지 않는다.
 * AGENT_TASK_APPROVAL_FLOOR(쉼표 구분)로 고른다. 빈 값이나 none 이면 바닥 없음(종전 동작).
 */
export const APPROVAL_FLOOR_KINDS = ['credential_write', 'third_party_tool', 'instruction_write', 'memory_write', 'site_write'] as const;
export type ApprovalFloorKind = typeof APPROVAL_FLOOR_KINDS[number];

/** PURE: 환경변수 값 → 바닥 종류. 미지정이면 전부, 모르는 이름은 버린다. */
export function parseApprovalFloorKinds(raw: string | undefined): ApprovalFloorKind[] {
    if (raw === undefined) return [...APPROVAL_FLOOR_KINDS];
    const wanted = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
    return APPROVAL_FLOOR_KINDS.filter((k) => wanted.has(k));
}

export const APPROVAL_FLOOR: ReadonlySet<ApprovalFloorKind> = new Set(parseApprovalFloorKinds(process.env.AGENT_TASK_APPROVAL_FLOOR));

/**
 * 에이전트 지시 파일 — 다음 실행의 에이전트(이 제품과 사용자의 다른 코딩 에이전트)가 지시로 읽는 파일.
 * 한 번 쓰이면 주입이 남으므로 자동승인에서도 묻는다(로컬 실행기는 사용자의 실제 저장소에 쓴다).
 * 경로 끝부분에 대는 글롭이다(대소문자 무시, `*` 는 구분자를 넘지 않음): 구분자가 없으면 파일명,
 * 있으면 끝 구간들, `/**` 로 끝나면 그 디렉토리 아래 전부. AGENT_TASK_INSTRUCTION_FILE_PATTERNS(쉼표 구분)로 바꾼다.
 */
export const INSTRUCTION_FILE_PATTERNS: readonly string[] = (process.env.AGENT_TASK_INSTRUCTION_FILE_PATTERNS
    ?? 'AGENTS.md,AGENTS.override.md,CLAUDE.md,CLAUDE.local.md,GEMINI.md,.cursorrules,.windsurfrules,.clinerules,.github/copilot-instructions.md,.cursor/rules/**,.claude/**')
    .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * 무인 실행(예약 실행)의 승인 결론 — 승인할 사람이 없는 작업에서 승인이 필요한 호출을 어떻게 끝낼지.
 *   reject  기다리지 않고 거절하고 이유를 모델에 알린다(기본)
 *   approve 기다리지 않고 통과시킨다. 바닥 호출(위 APPROVAL_FLOOR)은 이때도 거절한다
 *   wait    종전 동작 — 승인 대기 상한(TASK_SANDBOX_APPROVAL_TIMEOUT_MS, 기본 30분)까지 사람을 기다린다
 * 예약의 기본 승인 정책은 none(전부 자동)이라 승인 자체가 생기지 않는다 — 정책을 올린 예약
 * (AGENT_TASK_SCHEDULE_APPROVAL_POLICY=high-risk|all)에서만 달라진다. 질문 도구(ask_human·mcp_elicit)는 대상이 아니다.
 * AGENT_TASK_UNATTENDED_APPROVAL 로 고른다.
 */
export type UnattendedApprovalOutcome = 'reject' | 'approve' | 'wait';

/** PURE: 환경변수 값 → 결론. 모르는 값은 reject. */
export function parseUnattendedApprovalOutcome(raw: string | undefined): UnattendedApprovalOutcome {
    const v = raw?.trim().toLowerCase();
    return v === 'approve' || v === 'wait' ? v : 'reject';
}

/** PURE: 호출 하나의 결론 — 바닥 호출은 approve 설정에서도 거절한다(바닥 검사가 전체 허용보다 먼저). */
export function resolveUnattendedOutcome(mode: UnattendedApprovalOutcome, isFloorCall: boolean): UnattendedApprovalOutcome {
    return mode === 'approve' && isFloorCall ? 'reject' : mode;
}

export const UNATTENDED_APPROVAL_OUTCOME = parseUnattendedApprovalOutcome(process.env.AGENT_TASK_UNATTENDED_APPROVAL);
