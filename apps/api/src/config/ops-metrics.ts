/**
 * @module config/ops-metrics
 * @description 운영 지표 내장 도구 `ops_metrics` 설정 (2026-09-07, Phase 1)
 *
 * 외부 리뷰("Langfuse MCP 로 Monitoring Agent")를 실측 대조한 결과 — 관측 데이터는 이미
 * `agent_tasks`·`agent_task_steps`·`audit_logs(mcp_tool_call)`·`external_provider_usage` 에
 * 있고 없는 것은 **모델이 이 표를 질의할 도구 표면**뿐이었다(판정서
 * openmake_llm-docs/proposals/2026-09-07-agent-observability-mcp-verdict.md).
 * 새 백엔드(Langfuse/Phoenix) 없이 읽기 전용 명명 질의 1 도구로 시작하고, 실사용은
 * `audit_logs WHERE action='mcp_tool_call' AND resource_id='ops_metrics'` 로 센다.
 *
 * 노출은 **관리자 + 운영 질의 의도 턴에만**(프롬프트 다이어트 원칙 — 상시 노출 금지),
 * 실행은 `tool-role-gate` 가 `BUILTIN_TOOL_REQUIRED_ROLE` 로 2차 차단한다.
 */

/** 게이트 — 'false' 로 끄면 노출도 실행도 되지 않는다(기본 on). */
export const OPS_METRICS_TOOL_ENABLED = process.env.OPS_METRICS_TOOL_ENABLED !== 'false';

/**
 * 내장 도구별 최소 역할. `tool-role-gate.isToolRestrictedForRole` 가 네임스페이스(`::`) 없는
 * 이름에 대해 이 표를 본다 — 노출(filterRestrictedTools)과 실행(ToolRouter.executeTool)
 * 양쪽이 같은 표를 쓰므로 프롬프트 인젝션·REST 직접 호출로 이름을 지목해도 실행되지 않는다.
 * (종전엔 내장 도구에 선언적 게이트가 없어 핸들러 안 `isAdminRole` 분기뿐이었다.)
 */
export const BUILTIN_TOOL_REQUIRED_ROLE: Readonly<Record<string, 'admin' | 'user'>> = {
    ops_metrics: 'admin',
};

/** 운영 지표 질의 의도 — 실패/느린 작업, 도구 오류, 토큰·비용, 목표 미달, 운영 현황을 묻는 턴. */
export const OPS_METRICS_INTENT_PATTERNS: readonly RegExp[] = [
    /(실패|느린|오래\s*걸린|지연)[^\n]{0,10}(작업|task|에이전트|agent|run)/i,
    /(작업|task|에이전트|agent)[^\n]{0,10}(실패|성공률|오류율|에러율|지연|느려|얼마나\s*걸)/i,
    /(도구|tool|mcp|playwright|서버)[^\n]{0,12}(오류|에러|실패|error|fail)/i,
    /(토큰|token|비용|cost)[^\n]{0,10}(사용|소비|usage|많이|얼마)/i,
    /(목표\s*미달|goal_incomplete|judge|판정)[^\n]{0,10}(비율|건수|rate|현황)/i,
    /(운영|ops)\s*(지표|현황|상태|metrics|status)/i,
    /(지난|최근|오늘|today|last)\s*[0-9]*\s*(시간|hour|일|day|주|week)[^\n]{0,16}(작업|task|도구|tool|오류|error|토큰|token)/i,
    /ops_metrics/i,
];

/** 기간 창 → 시간. 도구 인자 `window` 의 enum 이자 SQL interval 의 단일 출처. */
export const OPS_METRICS_WINDOWS: Readonly<Record<string, number>> = {
    '1h': 1,
    '6h': 6,
    '24h': 24,
    '7d': 24 * 7,
    '30d': 24 * 30,
};

export const OPS_METRICS_LIMITS = {
    DEFAULT_WINDOW: '24h',
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 50,
    /** goal/error 스니펫 길이 — 결과는 MAX_TOOL_RESULT_CHARS(8000) 로 잘리므로 행당 예산을 둔다 */
    GOAL_SNIPPET_CHARS: 100,
    ERROR_SNIPPET_CHARS: 160,
} as const;
