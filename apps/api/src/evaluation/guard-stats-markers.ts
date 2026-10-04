/**
 * 가드 발동 집계(eval:guard-stats)의 표지 — 각 현상을 단계 기록(agent_task_steps)에서 알아보는 스텝 종류와 문구.
 *
 * 문구의 원본은 prompts/agent-task-*.ts 와 services/agent-task/ 의 스텝 기록 코드다. 여기에는 그 문구의 **변하지 않는 부분**만
 * 정규식으로 둔다(횟수·도구 이름은 달라진다). 원본 문구를 바꾸면 `__tests__/guard-stats.test.ts` 가 깨진다 — 그때 여기도 고친다.
 * 문구를 바꾸기 전의 기록은 새 표지에 잡히지 않는다.
 *
 * @module evaluation/guard-stats-markers
 */

export interface GuardStepMarker {
    id: string;
    /** 표에 찍는 이름. */
    label: string;
    /** 이 현상이 남는 스텝 종류(agent_task_steps.step_type). */
    stepType: string;
    /** 스텝 본문에 맞춰 보는 문구. 없으면 스텝 종류만으로 센다. */
    pattern?: RegExp;
}

export const GUARD_STEP_MARKERS: readonly GuardStepMarker[] = [
    // 도구 결과 — tool-result-truncate 의 생략 표시, tool-result-spill 의 보관 안내
    { id: 'tool_result_truncated', label: '도구 결과 절단(가운데 생략)', stepType: 'tool_result', pattern: /\.\.\.\[가운데 \d+자 생략 — 전체 \d+자\]\.\.\./ },
    { id: 'tool_result_spilled', label: '도구 결과 파일 보관', stepType: 'tool_result', pattern: /\[전체 결과 보관\]/ },
    // 턴 루프 — AgentTaskService·role-client 가 남기는 retry 스텝
    { id: 'empty_response_retry', label: '빈 응답 되묻기', stepType: 'retry', pattern: /^빈 응답 — 되묻기/ },
    { id: 'transient_retry', label: '일시적 오류 짧은 재시도', stepType: 'retry', pattern: /^일시적 LLM 오류 — 재시도 \d+\/\d+: (?!호출 상한\()(?![\s\S]*짧은 재시도 소진)/ },
    { id: 'call_cap_retry', label: '호출당 상한 초과·재시도', stepType: 'retry', pattern: /^일시적 LLM 오류 — 재시도 \d+\/\d+: 호출 상한\(/ },
    { id: 'recovery_wait', label: '재시도 소진 뒤 대기', stepType: 'retry', pattern: /짧은 재시도 소진, \d+초 기다린 뒤 다시 시도/ },
    { id: 'stall_nudge', label: '행동 예고 재촉', stepType: 'retry', pattern: /^행동 예고만 하고 멈춤 — 재촉/ },
    // 호출 가드 — turn-call-guards·tool-loop-guard 가 도구 결과로 돌려주는 문구
    { id: 'malformed_args_rejected', label: '깨진 인자 거부', stepType: 'tool_result', pattern: /^Error: \S+ 호출의 인자가 올바른 JSON 이 아니어서 실행하지 않았습니다/ },
    { id: 'duplicate_call_removed', label: '중복 호출 제거', stepType: 'tool_result', pattern: /^\[중복 호출\]/ },
    { id: 'loop_warn_failure', label: '반복 가드 안내(연속 실패)', stepType: 'tool_result', pattern: /\[반복 안내\] 같은 인자의 같은 호출이 \d+번 연속 실패/ },
    { id: 'loop_warn_same_result', label: '반복 가드 안내(같은 결과)', stepType: 'tool_result', pattern: /\[반복 안내\] 이 호출은 \d+번 연속 같은 결과/ },
    { id: 'loop_block_failure', label: '반복 가드 차단(연속 실패)', stepType: 'tool_result', pattern: /^Error: 이 호출\([^)]*\)은 같은 인자로 \d+번 연속 실패해 실행하지 않았습니다/ },
    { id: 'loop_block_same_result', label: '반복 가드 차단(같은 결과)', stepType: 'tool_result', pattern: /^Error: 이 호출\([^)]*\)은 같은 결과를 \d+번 연속 돌려줘 실행하지 않았습니다/ },
    // 컨텍스트·출력 — turn-call 의 기록 전용 스텝
    { id: 'context_trim', label: '컨텍스트 절단', stepType: 'context_trim' },
    { id: 'output_repetition', label: '출력 반복', stepType: 'output_repetition' },
    // 완료 관문 — task-steps 의 verify_skipped 스텝(사유 두 가지)
    { id: 'verify_skipped', label: '검증 건너뜀(재시도 상한)', stepType: 'verify_skipped', pattern: /^미검증 완료/ },
    { id: 'verify_held_answer', label: '검증 미통과 답변 채택(턴 상한)', stepType: 'verify_skipped', pattern: /^검증 미통과/ },
    // 승인 — prompts/agent-task-approval 의 거절 결과
    { id: 'approval_rejected_user', label: '승인 거절(사용자)', stepType: 'tool_result', pattern: /Error: 사용자가 도구 실행을 승인하지 않았습니다/ },
    { id: 'approval_rejected_unattended', label: '승인 거절(무인 실행)', stepType: 'tool_result', pattern: /승인이 필요한데, 지금은 승인할 사람이 없는 무인 실행/ },
    { id: 'approval_timeout', label: '승인 무응답', stepType: 'tool_result', pattern: /Error: 승인 대기 시간이 초과되었습니다/ },
    // 브라우저 — browser-result-guard 가 결과 뒤에 붙이는 경고
    { id: 'bot_block_warning', label: '봇 차단 경고', stepType: 'tool_result', pattern: /\[경고\] 이 페이지는 봇 차단·캡차 확인 화면으로 보입니다/ },
];

/** 인계 요약 — 단계 기록이 아니라 체크포인트의 대화에 user 메시지로 남는다(prompts/agent-task-context 의 HANDOFF_SUMMARY_MARKER). SQL LIKE 접두. */
export const GUARD_HANDOFF_SUMMARY_PREFIX = '[인계 요약]';

/** 예약 — 겹침 건너뛰기는 발화 이력의 outcome, 미도달 재실행은 작업 생성 멱등 키의 꼬리(schedule-runner). */
export const GUARD_SCHEDULE_MARKERS = {
    SKIPPED_OUTCOME: 'skipped',
    RETRY_FIRE_KEY_LIKE: 'sched:%:retry',
} as const;

/** 한 번에 읽는 스텝 행 수 — 본문(최대 약 8천 자)을 통째로 읽으므로 나눠 읽는다. OMK_EVAL_GUARD_STATS_BATCH */
export const GUARD_STATS_BATCH_ROWS = Number(process.env.OMK_EVAL_GUARD_STATS_BATCH) || 2000;

/** 서버 재시작 정리가 남기는 전이 사유(data/models/schema-initializer) — 이 전이가 있는 작업은 실패 통계에서 따로 센다. */
export const GUARD_RESTART_EVENT_REASON = 'server restarted';
