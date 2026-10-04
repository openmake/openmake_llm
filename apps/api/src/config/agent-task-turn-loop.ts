/**
 * 에이전트 작업 턴 루프 설정 — 오류 복구와 응답 가드의 임계값(hermes-agent 검토 "턴 루프·종료 조건·오류 복구").
 * 근거가 실측이 아닌 값은 주석에 그렇게 적는다 — 발동은 스텝으로 남으니 운영 집계 뒤 조정한다.
 *
 * @module config/agent-task-turn-loop
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

export const AGENT_TASK_TURN_LOOP = {
    /** 재시도 소진 뒤 대기 — 짧은 재시도(AGENT_TASK_TURN_RETRY_MAX, 2초·4초)가 다 실패한 일시적 오류(5xx·408·429·연결 끊김)를
     *  더 긴 간격으로 기다렸다가 다시 부른다. 모델 서버가 재기동 중일 때 예약 작업이 실패로 끝나던 것을 줄인다.
     *  남은 작업 시간 예산보다 길게는 기다리지 않는다. AGENT_TASK_RECOVERY_WAIT=false 로 끈다. */
    RECOVERY_WAIT_ENABLED: process.env.AGENT_TASK_RECOVERY_WAIT !== 'false',
    /** 대기 횟수와 간격(첫 대기·상한) — 15·30·60·60·60초. 실측이 아니라 hermes-agent 의 값이다.
     *  AGENT_TASK_RECOVERY_WAIT_MAX_CYCLES / _BASE_MS / _CAP_MS */
    RECOVERY_WAIT_MAX_CYCLES: num(process.env.AGENT_TASK_RECOVERY_WAIT_MAX_CYCLES, 5),
    RECOVERY_WAIT_BASE_MS: num(process.env.AGENT_TASK_RECOVERY_WAIT_BASE_MS, 15_000),
    RECOVERY_WAIT_CAP_MS: num(process.env.AGENT_TASK_RECOVERY_WAIT_CAP_MS, 60_000),
    /** 말만 하고 멈춘 턴 재촉 — 도구 호출 없이 다음 행동 예고로 끝난 짧은 응답을 최종 답변으로 받지 않고 되묻는 횟수(작업당).
     *  첫 턴의 계획-만 재촉과 별개다. 0 이면 끈다. AGENT_TASK_STALL_NUDGE_MAX */
    STALL_NUDGE_MAX: num(process.env.AGENT_TASK_STALL_NUDGE_MAX, 2),
    /** 이보다 긴 응답은 실질 답변으로 보고 재촉하지 않는다 / 예고를 찾는 끝부분 길이. 실측이 아니라 hermes-agent 의 값이다. */
    STALL_MAX_CHARS: num(process.env.AGENT_TASK_STALL_MAX_CHARS, 400),
    STALL_TAIL_CHARS: 160,
    /** 컨텍스트 절단 기록 — 창 초과로 요청 사본에서 오래된 메시지를 잘라낸 호출을 단계 기록(context_trim)으로 남긴다.
     *  AGENT_TASK_CONTEXT_TRIM_STEP=false 로 기록을 끈다(반복 시 마무리 전환은 아래 FINALIZE 가 따로 켠다). */
    CONTEXT_TRIM_STEP_ENABLED: process.env.AGENT_TASK_CONTEXT_TRIM_STEP !== 'false',
    /** 컨텍스트 절단 반복 시 마무리 전환 — 창 초과로 대화를 줄인 턴(인계 요약·창 초과 오류 뒤 줄이기·안전망 절단)이 작업 안에서
     *  이 횟수에 닿으면, 다음 턴부터 도구를 막고 지금까지의 결과로 답을 마무리하게 한다(턴 상한 직전의 마무리 턴과 같은 경로).
     *  횟수 2는 실측이 아니다. AGENT_TASK_CONTEXT_TRIM_FINALIZE=false 로 끈다(종전처럼 기록만). AGENT_TASK_CONTEXT_TRIM_FINALIZE_AFTER */
    CONTEXT_TRIM_FINALIZE_ENABLED: process.env.AGENT_TASK_CONTEXT_TRIM_FINALIZE !== 'false',
    CONTEXT_TRIM_FINALIZE_AFTER: num(process.env.AGENT_TASK_CONTEXT_TRIM_FINALIZE_AFTER, 2),
    /** 잘린 도구 호출을 실행하지 않기 — 인자 JSON 파싱이 실패한 호출을 빈 인자로 실행하지 않고 오류 결과를 돌려준다.
     *  AGENT_TASK_REJECT_MALFORMED_TOOL_ARGS=false 면 종전처럼 빈 인자로 실행한다. */
    REJECT_MALFORMED_TOOL_ARGS: process.env.AGENT_TASK_REJECT_MALFORMED_TOOL_ARGS !== 'false',
    /** 한 턴 내 중복 호출 제거 — 한 응답 안에 이름·인자가 같은 읽기·검색 호출이 여럿이면 한 번만 실행하고
     *  나머지에는 앞선 호출을 가리키는 짧은 결과를 준다. 부작용 있는 도구는 대상이 아니다. AGENT_TASK_DEDUPE_TOOL_CALLS=false 로 끈다. */
    DEDUPE_TOOL_CALLS: process.env.AGENT_TASK_DEDUPE_TOOL_CALLS !== 'false',
    /** 출력 반복 기록 — 응답 본문에서 같은 구간(창)이 같은 간격으로, 사이의 글까지 같게 되풀이되면 단계 기록(output_repetition)을 남긴다.
     *  AGENT_TASK_OUTPUT_REPETITION_STEP=false 로 기록을 끈다(자르기는 아래 CUT 이 따로 켠다). */
    OUTPUT_REPETITION_STEP_ENABLED: process.env.AGENT_TASK_OUTPUT_REPETITION_STEP !== 'false',
    /** 출력 반복 대응 — 반복이 감지된 응답은 반복이 시작된 뒤를 잘라 대화에 넣는다(도구 호출이 함께 오면 본문만 자르고 호출은 실행).
     *  최종 답이 될 응답이었으면 작업당 RETRY_MAX 회 다시 요청한다(0 이면 다시 요청하지 않음).
     *  AGENT_TASK_OUTPUT_REPETITION_CUT=false 면 종전처럼 기록만 한다. AGENT_TASK_OUTPUT_REPETITION_RETRY_MAX */
    OUTPUT_REPETITION_CUT_ENABLED: process.env.AGENT_TASK_OUTPUT_REPETITION_CUT !== 'false',
    OUTPUT_REPETITION_RETRY_MAX: num(process.env.AGENT_TASK_OUTPUT_REPETITION_RETRY_MAX, 1),
    /** 창 길이(자)·반복 횟수 임계 — 60자 창이 5회 이상. 실측이 아니라 hermes-agent 의 값이다.
     *  AGENT_TASK_OUTPUT_REPETITION_WINDOW_CHARS / _MIN_REPEATS */
    OUTPUT_REPETITION_WINDOW_CHARS: num(process.env.AGENT_TASK_OUTPUT_REPETITION_WINDOW_CHARS, 60),
    OUTPUT_REPETITION_MIN_REPEATS: num(process.env.AGENT_TASK_OUTPUT_REPETITION_MIN_REPEATS, 5),
    /** 긴 응답은 끝에서 이만큼만 검사한다(검사 비용 상한) / 창 안의 글자 종류가 이보다 적으면 구분선·공백으로 보고 건너뛴다. */
    OUTPUT_REPETITION_SCAN_TAIL_CHARS: 20_000,
    OUTPUT_REPETITION_MIN_DISTINCT_CHARS: 8,
    /** 의도된 반복 — 작업 목표가 횟수를 붙여 반복 출력을 시켰으면("100번 써 줘") 자르지 않고 기록만 한다.
     *  횟수는 이름 붙은 그룹 n — 숫자면 MIN_REPEATS 이상일 때만 요청으로 본다("3번 파일" 같은 번호는 제외), 한글 수사는 그대로 요청으로 본다.
     *  AGENT_TASK_OUTPUT_REPETITION_RESPECT_REQUEST=false 면 종전처럼 항상 자른다. */
    OUTPUT_REPETITION_RESPECT_REQUEST: process.env.AGENT_TASK_OUTPUT_REPETITION_RESPECT_REQUEST !== 'false',
    OUTPUT_REPETITION_REQUEST_PATTERNS: [
        /(?<n>\d+|열|스무|서른|마흔|쉰|백|천|수십|수백)\s*(?:번|회|차례|줄)[^.\n]{0,40}?(?:반복|되풀이|써|쓰|적어|적으|출력|나열)/g,
        /(?:반복|되풀이)[^.\n]{0,40}?(?<n>\d+|열|스무|서른|마흔|쉰|백|천|수십|수백)\s*(?:번|회|차례|줄)/g,
        /\b(?:repeat|print|write|output|say)\b[^.\n]{0,80}?\b(?<n>\d+)\s*(?:times|x)\b/gi,
        /\b(?<n>\d+)\s*times\b[^.\n]{0,80}?\b(?:repeat|print|write|output)/gi,
    ] as readonly RegExp[],
    /** 주기 반복 가드 — 서로 다른 도구 호출 2~MAX_PERIOD 개가 이름·인자도 결과도 같게 번갈아 되풀이되면(A-B-A-B) 안내하고,
     *  임계를 넘으면 실행하지 않는다. 같은 호출의 연속 반복(AGENT_TASK_TOOL_LOOP_*)이 못 잡는 경우다. AGENT_TASK_TOOL_LOOP_CYCLE=false 로 끈다. */
    TOOL_LOOP_CYCLE_ENABLED: process.env.AGENT_TASK_TOOL_LOOP_CYCLE !== 'false',
    /** 같은 주기가 이 바퀴째 같은 결과로 끝나면 안내 / 이 바퀴를 다 돈 뒤 주기를 이어가는 호출은 실행하지 않음 / 보는 주기 길이 상한.
     *  실측이 아니다 — hermes-agent 는 주기 4까지 본다. AGENT_TASK_TOOL_LOOP_CYCLE_WARN / _BLOCK / _MAX_PERIOD */
    TOOL_LOOP_CYCLE_WARN: num(process.env.AGENT_TASK_TOOL_LOOP_CYCLE_WARN, 2),
    TOOL_LOOP_CYCLE_BLOCK: num(process.env.AGENT_TASK_TOOL_LOOP_CYCLE_BLOCK, 3),
    TOOL_LOOP_CYCLE_MAX_PERIOD: num(process.env.AGENT_TASK_TOOL_LOOP_CYCLE_MAX_PERIOD, 3),
    /** 같은 구간 다시 읽기 안내 — 파일 보기(str_replace_editor view)가 바뀌지 않은 같은 파일·같은 구간을 다시 읽으면 2회째에 바로
     *  "이미 읽은 구간"이라는 한 줄을 결과에 붙인다(내용은 그대로, 차단 없음). 그 사이에 편집·셸 호출이 있었으면 붙이지 않는다.
     *  AGENT_TASK_REREAD_NOTE=false 로 끈다. */
    REREAD_NOTE_ENABLED: process.env.AGENT_TASK_REREAD_NOTE !== 'false',
    /** 검증이 보류한 답변 보존 — 검증 실패로 턴을 이어가다 턴 상한에 걸리면, 들고 있던 직전 완성 답변을 버리지 않고
     *  "검증 미통과" 표시(verify_skipped 스텝)와 함께 결과로 남긴다. 판정(마커·goal judge)은 그대로 거친다.
     *  AGENT_TASK_KEEP_HELD_ANSWER=false 면 종전처럼 max_turns_exhausted 실패로 끝난다. */
    KEEP_HELD_ANSWER: process.env.AGENT_TASK_KEEP_HELD_ANSWER !== 'false',
};

/**
 * 응답 끝의 행동 예고 — "이제/다음으로/먼저 … 하겠습니다", "Now I'll …", "Let me now …".
 * 순서를 알리는 말이 같은 문장에 있어야 한다: "더 도와드리겠습니다" 같은 맺음 인사는 걸리지 않는다.
 * AGENT_TASK_STALL_INTENT_PATTERN 으로 바꾼다(대소문자 무시).
 */
export const AGENT_TASK_STALL_INTENT_RE = new RegExp(
    process.env.AGENT_TASK_STALL_INTENT_PATTERN
        || '(?:(?:이제|이어서|다음으로|다음에는?|다음 단계로|먼저|우선|곧바로|지금부터)[^.!?。\n]{0,100}(?:겠습니다|겠어요|게요)'
            + "|\\b(?:(?:now|next|first)[,:]?\\s+(?:let me|i(?:'|’)ll|i will|i am going to|i'm going to)"
            + "|(?:let me|i(?:'|’)ll|i will)\\s+(?:now|next|first|go ahead and|proceed to|start by))\\b[^.!?\n]{0,100})"
            + '[.:…]?\\s*$',
    'i',
);
