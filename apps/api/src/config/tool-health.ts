/**
 * 도구 헬스 관측 설정 (L2).
 *
 * 도구별 실패율 조회의 기본값·상한. 상한은 관리자 UI 가 큰 값을 보내도 집계가 폭주하지
 * 않게 하는 방어선이다(소스 `audit_logs` 는 전 사용자 도구 호출이 쌓이는 테이블).
 *
 * ⚠️ 실패율 상위는 조회 창(days)에 따라 뒤집힌다 — 60일 누계 1위 도구가 30일로는 하위인
 * 사례가 실측됐다(2026-08-28). 창과 최소 표본을 호출자가 정할 수 있어야 하는 이유.
 *
 * @module config/tool-health
 */

/** 도구 헬스 조회 파라미터 기본값·경계. */
export const TOOL_HEALTH_QUERY = {
    /** 기본 조회 기간(일). */
    DEFAULT_DAYS: parseInt(process.env.TOOL_HEALTH_DEFAULT_DAYS || '30', 10),
    /** 조회 가능한 최대 기간(일). */
    MAX_DAYS: parseInt(process.env.TOOL_HEALTH_MAX_DAYS || '180', 10),
    /** 목록에 포함할 최소 호출 수 — 1회 호출 1회 실패(100%)가 상위를 점거하는 것을 막는다. */
    DEFAULT_MIN_CALLS: parseInt(process.env.TOOL_HEALTH_DEFAULT_MIN_CALLS || '3', 10),
    /** minCalls 상한. */
    MAX_MIN_CALLS: parseInt(process.env.TOOL_HEALTH_MAX_MIN_CALLS || '1000', 10),
    /** 기본 반환 도구 수. */
    DEFAULT_LIMIT: parseInt(process.env.TOOL_HEALTH_DEFAULT_LIMIT || '30', 10),
    /** 반환 도구 수 상한. */
    MAX_LIMIT: parseInt(process.env.TOOL_HEALTH_MAX_LIMIT || '200', 10),
} as const;

/**
 * 도구 서킷 브레이커 설정.
 *
 * 반복 실패하는 도구를 일정 시간 노출에서 빼고, 호출되더라도 즉시 거절해 대체 경로를
 * 안내한다. 서버가 `crashed` 면 user-pool 에 없어 자동 제외되지만, **서버는 살아 있는데
 * 도구만 실패하는 경우**(헤드리스 브라우저 런처 실패·인증 만료 등)는 계속 노출된다.
 *
 * 설계에서 가장 중요한 두 결정:
 *  ① `EXCLUDED_CATEGORIES` — `invalid_args`(모델이 인자를 틀림)·`not_found`(대상 부재)·
 *     `output_truncated`(결과는 나왔다)는 **도구 고장이 아니다**. 이걸 세면 정상 도구가
 *     차단된다(오탐이 이 기능의 최악 실패 모드).
 *  ② `SCOPE='external'` — 내장 도구는 실패해도 노출에서 빼지 않는다. `web_search` 같은
 *     핵심 경로가 사라지는 손실이 크고, 내장 도구 실패는 대개 인자·사용자 오류다.
 *     서킷의 실제 동기는 죽은 외부 MCP 서버의 도구다.
 *
 * ⚠️ `FAILURE_THRESHOLD` 는 연결 사망 self-heal(`external-client` 의 evict → respawn)보다
 * 크게 잡는다 — self-heal 로 고쳐질 실패에 서킷이 먼저 열리면 복구를 방해한다.
 * ⚠️ 상태는 프로세스 메모리다(단일 API 인스턴스 전제). 재시작 시 리셋되는 편이
 * "서버를 고쳤는데 여전히 차단"보다 안전하다.
 */
export const TOOL_CIRCUIT = {
    /** 기능 게이트 — 기본 OFF. 관측(PR1) 데이터로 임계값을 확정한 뒤 켠다. */
    ENABLED: process.env.TOOL_HEALTH_CIRCUIT_ENABLED === 'true',
    /** 대상 범위: 'external'=네임스페이스 외부 도구만, 'all'=내장 포함. */
    SCOPE: (process.env.TOOL_HEALTH_CIRCUIT_SCOPE === 'all' ? 'all' : 'external') as 'external' | 'all',
    /** 창 안 실패가 이 수에 도달하면 OPEN. self-heal 재시도보다 크게. */
    FAILURE_THRESHOLD: parseInt(process.env.TOOL_HEALTH_CIRCUIT_FAILURE_THRESHOLD || '5', 10),
    /** 실패·호출 집계 창(ms). 창을 벗어난 기록은 버린다. */
    WINDOW_MS: parseInt(process.env.TOOL_HEALTH_CIRCUIT_WINDOW_MS || '600000', 10),
    /** 창 안 최소 호출 수 — 표본이 적으면 열지 않는다. */
    MIN_CALLS: parseInt(process.env.TOOL_HEALTH_CIRCUIT_MIN_CALLS || '3', 10),
    /** 최초 차단 시간(ms). */
    OPEN_MS: parseInt(process.env.TOOL_HEALTH_CIRCUIT_OPEN_MS || '300000', 10),
    /** 재차단 시 차단 시간 상한(ms) — 무한 증가 방지. */
    OPEN_MS_MAX: parseInt(process.env.TOOL_HEALTH_CIRCUIT_OPEN_MS_MAX || '1800000', 10),
    /** HALF_OPEN 에서 다시 실패했을 때 차단 시간 배수. */
    OPEN_BACKOFF_FACTOR: parseInt(process.env.TOOL_HEALTH_CIRCUIT_BACKOFF_FACTOR || '2', 10),
    /** 실패로 세지 않는 분류 — 도구 고장이 아닌 것들(위 ① 참고). */
    EXCLUDED_CATEGORIES: (process.env.TOOL_HEALTH_CIRCUIT_EXCLUDED_CATEGORIES
        || 'invalid_args,not_found,output_truncated').split(',').map((s) => s.trim()).filter(Boolean),
    /** 추적 도구 수 상한 — 오래된 항목부터 버린다(메모리 무한 증가 방지). */
    MAX_TRACKED_TOOLS: parseInt(process.env.TOOL_HEALTH_CIRCUIT_MAX_TRACKED || '500', 10),
} as const;
