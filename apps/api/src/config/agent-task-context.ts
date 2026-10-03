/**
 * 에이전트 작업의 컨텍스트 관리 설정 — 접힌 스텁, 접기 묶음, 창 초과 대응, 큰 결과 보관.
 * 전부 env 로 덮어쓴다(No-Hardcoding L1/L2). 접기 자체의 스위치·임계는 종전대로 AGENT_TASK_LIMITS.CONTEXT_FOLD_* 에 있다.
 *
 * @module config/agent-task-context
 */

function intEnv(key: string, def: number): number {
    const n = parseInt(process.env[key] ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : def;
}

/** 접힌 스텁의 도구별 한 줄(무엇을 했고 결과가 어땠나) — services/agent-task/tool-digest. */
export const TOOL_DIGEST = {
    /** 끄면 종전 스텁(도구 이름·글자 수·앞부분)만 남긴다. AGENT_TASK_TOOL_DIGEST=false */
    ENABLED: process.env.AGENT_TASK_TOOL_DIGEST !== 'false',
    /** 한 줄에 싣는 명령·경로·질의의 최대 글자 수. AGENT_TASK_TOOL_DIGEST_SUBJECT_MAX_CHARS */
    SUBJECT_MAX_CHARS: intEnv('AGENT_TASK_TOOL_DIGEST_SUBJECT_MAX_CHARS', 120),
    /** 실패했을 때 싣는 오류 줄의 최대 글자 수. AGENT_TASK_TOOL_DIGEST_ERROR_MAX_CHARS */
    ERROR_MAX_CHARS: intEnv('AGENT_TASK_TOOL_DIGEST_ERROR_MAX_CHARS', 160),
    /** 브라우저 한 줄에 싣는 액션 수 상한 — 넘으면 앞에서부터 이만큼만. AGENT_TASK_TOOL_DIGEST_BROWSER_MAX_ACTIONS */
    BROWSER_MAX_ACTIONS: intEnv('AGENT_TASK_TOOL_DIGEST_BROWSER_MAX_ACTIONS', 6),
    /** 셸 계열 — 결과 끝의 `[exit=N ...]` 줄에서 종료 코드를 읽는다(task-sandbox/tools.ts 의 formatExec 형식). */
    SHELL_TOOLS: ['bash', 'python_execute'] as readonly string[],
    /** 파일 계열 — 인자의 command/op 와 path 를 싣는다. */
    FILE_TOOLS: ['str_replace_editor', 'file_ops'] as readonly string[],
    /** 검색 계열로 볼 질의 인자 이름(앞에서부터 먼저 있는 것). 도구 판별은 AGENT_TASK_LIMITS.SEARCH_TOOL_KEYWORDS 와 grep_code. */
    QUERY_ARG_KEYS: ['pattern', 'query', 'q', 'url', 'urls', 'topic'] as readonly string[],
} as const;

/** 접기를 묶음으로 — services/agent-task/context-fold. */
export const CONTEXT_FOLD_BATCH = {
    /**
     * 한 번에 새로 접어 회수할 글자 수가 이보다 적으면 그 턴에는 과거 메시지를 고치지 않는다.
     * 기본 0 = 종전 동작(접을 것이 생기면 매 턴 접음). 접두 캐시 적중이 얼마나 느는지는 실측하지 않았다 —
     * 올리면 접기가 늦어져 재전송 글자 수가 그만큼 늘어나므로, 캐시 적중률을 보고 정한다.
     * AGENT_TASK_CONTEXT_FOLD_MIN_BATCH_CHARS
     */
    MIN_SAVED_CHARS: intEnv('AGENT_TASK_CONTEXT_FOLD_MIN_BATCH_CHARS', 0),
} as const;

/** 창 초과로 오래된 메시지를 버릴 때 남기는 인계 요약 — services/agent-task/context-handoff. */
export const CONTEXT_HANDOFF = {
    /**
     * 켜면 작업 루프가 호출 전에 창 초과를 판정해 오래된 메시지를 요약 하나로 바꾼다(LLM 없음).
     * 끄면 종전대로 LLMClient 의 안전망이 요청 사본에서 말없이 잘라낸다. AGENT_TASK_CONTEXT_HANDOFF=false
     */
    ENABLED: process.env.AGENT_TASK_CONTEXT_HANDOFF !== 'false',
    /** 요약 전체 글자 수 상한 — 예산 계산에서 이만큼을 요약 몫으로 떼어 둔다. AGENT_TASK_CONTEXT_HANDOFF_MAX_CHARS */
    SUMMARY_MAX_CHARS: intEnv('AGENT_TASK_CONTEXT_HANDOFF_MAX_CHARS', 6000),
    /** 원래 요청에서 싣는 글자 수. AGENT_TASK_CONTEXT_HANDOFF_REQUEST_MAX_CHARS */
    REQUEST_MAX_CHARS: intEnv('AGENT_TASK_CONTEXT_HANDOFF_REQUEST_MAX_CHARS', 600),
    /** 도구 호출 목록 상한(최근 것부터 남긴다). AGENT_TASK_CONTEXT_HANDOFF_MAX_CALLS */
    MAX_CALLS: intEnv('AGENT_TASK_CONTEXT_HANDOFF_MAX_CALLS', 40),
    /** 관련 파일 목록 상한. AGENT_TASK_CONTEXT_HANDOFF_MAX_FILES */
    MAX_FILES: intEnv('AGENT_TASK_CONTEXT_HANDOFF_MAX_FILES', 30),
    /** 오류 목록 상한. AGENT_TASK_CONTEXT_HANDOFF_MAX_ERRORS */
    MAX_ERRORS: intEnv('AGENT_TASK_CONTEXT_HANDOFF_MAX_ERRORS', 10),
    /**
     * 줄인 뒤의 목표 크기 — 입력 예산의 이 비율까지 줄인다(0~1). 예산에 딱 맞추면 다음 턴에 또 넘쳐
     * 매 턴 과거가 바뀐다. AGENT_TASK_CONTEXT_HANDOFF_TARGET_RATIO
     */
    TARGET_RATIO: Math.min(1, Math.max(0.1, parseFloat(process.env.AGENT_TASK_CONTEXT_HANDOFF_TARGET_RATIO || '') || 0.7)),
    /** 파일 경로로 볼 인자 이름. */
    PATH_ARG_KEYS: ['path', 'filename'] as readonly string[],
} as const;

/** 작업 루프의 토큰 추정 보정 — services/agent-task/context-estimate. */
export const CONTEXT_ESTIMATE = {
    /** 직전 호출의 실제 사용량(prompt_tokens)으로 다음 판정을 올려 잡는다. AGENT_TASK_CONTEXT_CALIBRATION=false 로 끈다. */
    CALIBRATION_ENABLED: process.env.AGENT_TASK_CONTEXT_CALIBRATION !== 'false',
    /**
     * 보정 계수 상한 — 실측상 문자 추정이 가장 낮게 나온 경우가 실제의 30%(hex)라 3.3배면 덮인다.
     * 그보다 큰 비율은 측정 이상으로 보고 묶는다. AGENT_TASK_CONTEXT_CALIBRATION_MAX_SCALE
     */
    MAX_SCALE: Math.max(1, parseFloat(process.env.AGENT_TASK_CONTEXT_CALIBRATION_MAX_SCALE || '') || 4),
} as const;
