/**
 * 브라우저·웹·MCP 영역 설정 (hermes 도입 2단계) — No-Hardcoding L1/L2.
 *
 * 영역 전용 파일이다 — 공용 설정 파일(runtime-limits·task-sandbox)에 줄을 더하지 않으려고 따로 둔다.
 *
 * @module config/agent-task-browser-web
 */

function intEnv(raw: string | undefined, def: number): number {
    const n = parseInt(raw ?? '', 10);
    return Number.isFinite(n) && n > 0 ? n : def;
}

/** 에이전트 browser 도구의 일회성 컨테이너 실행. */
export const BROWSER_RUN = {
    /**
     * 일회성 브라우저 컨테이너 이름 접두 — 뒤에 작업 id 와 호출마다 다른 꼬리가 붙는다.
     * 영속 샌드박스(omk-task-)·넘겨받기 세션(omk-browser-)의 이름 필터에 걸리지 않는 값이어야 한다
     * (docker 의 name 필터는 부분 일치다 — 걸리면 동시 실행 상한 집계에 섞인다).
     */
    CONTAINER_PREFIX: 'omk-brun-',
    /** 브라우저 한 번 실행의 최소 상한(ms) — 명령 상한(TASK_SANDBOX_EXEC_TIMEOUT_MS)이 더 짧아도 이만큼은 준다. */
    MIN_TIMEOUT_MS: intEnv(process.env.TASK_SANDBOX_BROWSER_MIN_TIMEOUT_MS, 90_000),
    /**
     * 실행이 끝난 뒤 넘겨받기(Take control) 여부를 다시 확인해, 그 사이 사용자가 넘겨받았으면 결과를 버린다.
     * 호출마다 `docker inspect` 한 번이 더 든다. TASK_SANDBOX_BROWSER_TAKEOVER_RECHECK=false 로 끈다.
     */
    TAKEOVER_RECHECK_ENABLED: process.env.TASK_SANDBOX_BROWSER_TAKEOVER_RECHECK !== 'false',
} as const;
