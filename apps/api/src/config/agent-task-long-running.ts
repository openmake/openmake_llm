/**
 * 에이전트 작업 장기 실행·후속 작업 체인 설정 (2026-10-14 설계).
 *
 * 한 작업(세그먼트)의 상한(AGENT_TASK_LIMITS 의 턴·시간·토큰)은 그대로 두고, 상한에 닿으면 끝내는 대신
 * 인계 요약·작업 공간을 넘겨 후속 작업으로 잇는다. 체인 전체의 예산은 여기서 정한다.
 * 기본 꺼짐 — 켜지 않으면 longRunning 요청은 400 이고 기존 작업은 종전과 같다.
 *
 * @module config/agent-task-long-running
 */
function num(key: string, def: number): number {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? n : def;
}

const HOUR = 60 * 60 * 1000;

export const AGENT_TASK_LONG_RUNNING = {
    /** 기능 게이트. AGENT_TASK_LONG_RUNNING=true 로 켠다. */
    ENABLED: process.env.AGENT_TASK_LONG_RUNNING === 'true',
    /** 체인 벽시계 기본/절대 상한(ms) — 승인 대기(주차) 시간은 빼고 센다. */
    DEFAULT_MS: num('AGENT_TASK_LONG_RUNNING_DEFAULT_MS', 8 * HOUR),
    MAX_MS: num('AGENT_TASK_LONG_RUNNING_MAX_MS', 24 * HOUR),
    /** 체인 누적 토큰(입력+출력) 기본/절대 상한. */
    DEFAULT_TOKENS: num('AGENT_TASK_LONG_RUNNING_DEFAULT_TOKENS', 5_000_000),
    MAX_TOKENS: num('AGENT_TASK_LONG_RUNNING_MAX_TOKENS', 20_000_000),
    /** 세그먼트(작업) 수 기본/절대 상한 — 루트 포함. */
    DEFAULT_SEGMENTS: num('AGENT_TASK_LONG_RUNNING_DEFAULT_SEGMENTS', 12),
    MAX_SEGMENTS: num('AGENT_TASK_LONG_RUNNING_MAX_SEGMENTS', 48),
    /** 컨텍스트 사용률(추정 토큰/입력 예산)이 이 값 이상이면 이어간다. 0.5~0.99. */
    CONTINUE_AT_RATIO: Math.min(0.99, Math.max(0.5, num('AGENT_TASK_LONG_RUNNING_CONTINUE_AT_RATIO', 0.9))),
    /** 인계 턴("다음에 할 일") 답 상한(자). */
    HANDOFF_TURN_MAX_CHARS: num('AGENT_TASK_LONG_RUNNING_HANDOFF_TURN_MAX_CHARS', 2000),
    /** 인계 턴 호출 제한 시간(ms). 넘기면 계획의 미완 항목으로 대신한다. */
    HANDOFF_TURN_TIMEOUT_MS: num('AGENT_TASK_LONG_RUNNING_HANDOFF_TURN_TIMEOUT_MS', 60_000),
    /** 세그먼트 활성 시간이 세그먼트 시간 상한(totalTimeoutMs)의 이 비율 이상이면 시간 초과로 끝나기 전에 이어간다. 0.5~0.95. */
    SEGMENT_TIME_RATIO: Math.min(0.95, Math.max(0.5, num('AGENT_TASK_LONG_RUNNING_SEGMENT_TIME_RATIO', 0.8))),
} as const;
