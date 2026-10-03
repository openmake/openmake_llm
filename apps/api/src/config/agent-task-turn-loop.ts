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
};
