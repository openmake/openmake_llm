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
     *  기록만 한다(대응은 발동 빈도를 본 뒤). AGENT_TASK_CONTEXT_TRIM_STEP=false 로 끈다. */
    CONTEXT_TRIM_STEP_ENABLED: process.env.AGENT_TASK_CONTEXT_TRIM_STEP !== 'false',
    /** 잘린 도구 호출을 실행하지 않기 — 인자 JSON 파싱이 실패한 호출을 빈 인자로 실행하지 않고 오류 결과를 돌려준다.
     *  AGENT_TASK_REJECT_MALFORMED_TOOL_ARGS=false 면 종전처럼 빈 인자로 실행한다. */
    REJECT_MALFORMED_TOOL_ARGS: process.env.AGENT_TASK_REJECT_MALFORMED_TOOL_ARGS !== 'false',
    /** 한 턴 내 중복 호출 제거 — 한 응답 안에 이름·인자가 같은 읽기·검색 호출이 여럿이면 한 번만 실행하고
     *  나머지에는 앞선 호출을 가리키는 짧은 결과를 준다. 부작용 있는 도구는 대상이 아니다. AGENT_TASK_DEDUPE_TOOL_CALLS=false 로 끈다. */
    DEDUPE_TOOL_CALLS: process.env.AGENT_TASK_DEDUPE_TOOL_CALLS !== 'false',
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
