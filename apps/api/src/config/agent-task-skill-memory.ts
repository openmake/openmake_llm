/**
 * 에이전트 작업의 스킬·학습·메모리 설정 (hermes 도입 2단계 — 영역 5).
 * 절차 스킬 휴면 판정·저장 시 구조 검사·교훈 조회 조건·메모리 주입 순서·과거 작업 검색 도구.
 *
 * @module config/agent-task-skill-memory
 */
const num = (v: string | undefined, d: number): number => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : d;
};

/**
 * 절차 스킬 휴면 — 연속 실패하거나 오래 쓰이지 않은 스킬을 이름 매칭·재사용 제안 후보에서 뺀다.
 * 행은 지우지 않는다. 정확한 skill_id 로는 계속 재생되고, 고쳐 쓰거나(갱신) 다시 성공하면 후보로 돌아온다.
 */
export const PROCEDURAL_DORMANCY = {
    /** AGENT_TASK_PROCEDURAL_DORMANCY=false 로 끈다. */
    ENABLED: process.env.AGENT_TASK_PROCEDURAL_DORMANCY !== 'false',
    /** 마지막 갱신 뒤의 재생이 이 횟수만큼 연속 실패하면 휴면. AGENT_TASK_PROCEDURAL_DORMANT_FAIL_STREAK */
    FAIL_STREAK: num(process.env.AGENT_TASK_PROCEDURAL_DORMANT_FAIL_STREAK, 3),
    /** 저장·갱신·재생이 모두 이 일수보다 오래됐으면 휴면. AGENT_TASK_PROCEDURAL_DORMANT_STALE_DAYS */
    STALE_DAYS: num(process.env.AGENT_TASK_PROCEDURAL_DORMANT_STALE_DAYS, 90),
} as const;

/**
 * 절차 스킬 저장 시 구조 검사 — 브라우저 러너(infra/task-runtime/browser-runner.mjs)가 아는 액션과 액션별 필수 값.
 * 러너에 액션이 늘면 여기도 맞춘다(모르는 액션은 러너가 재생 때 '알 수 없는 action' 으로 실패한다).
 */
export const PROCEDURAL_STRUCTURE = {
    /** AGENT_TASK_PROCEDURAL_STRUCTURE_CHECK=false 로 끈다. */
    ENABLED: process.env.AGENT_TASK_PROCEDURAL_STRUCTURE_CHECK !== 'false',
    /** 액션 종류 → 비어 있으면 안 되는 문자열 필드. */
    ACTION_REQUIRED_FIELDS: {
        goto: ['url'],
        click: ['selector'],
        fill: ['selector'],
        snapshot: [],
        smartClick: ['role'],
        smartFill: ['role'],
        press: ['key'],
        wait: [],
        waitFor: ['selector'],
        screenshot: [],
        extractText: [],
        extractHtml: [],
    } as Readonly<Record<string, readonly string[]>>,
} as const;
