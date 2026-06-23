/**
 * 클라이언트 타이밍/한계 상수 (No-Hardcoding 정책).
 *
 * 폴링 간격·타임아웃·backoff 등 매직넘버를 한 곳에 명명 상수로 모은다.
 * NEXT_PUBLIC_* 환경변수로 빌드타임 오버라이드 가능(미설정 시 기본값).
 *
 * @module lib/config
 */

function envNum(v: string | undefined, d: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export const CLIENT_TIMING = {
  /** 딥리서치 진행 폴링 간격(ms) */
  RESEARCH_POLL_MS: envNum(process.env.NEXT_PUBLIC_RESEARCH_POLL_MS, 2500),
  /** 딥리서치 폴링 일시 실패 시 재시도 간격(ms) */
  RESEARCH_POLL_RETRY_MS: envNum(process.env.NEXT_PUBLIC_RESEARCH_POLL_RETRY_MS, 4000),
  /** MCP 모니터링 자동 새로고침 간격(ms) */
  MCP_MONITORING_REFRESH_MS: envNum(process.env.NEXT_PUBLIC_MCP_MONITORING_REFRESH_MS, 30_000),
  /** WebSocket 재연결 backoff 기본값(ms) — 실제 지연 = base * 2^attempt (MAX 상한) */
  WS_RECONNECT_BASE_MS: envNum(process.env.NEXT_PUBLIC_WS_RECONNECT_BASE_MS, 1000),
  /** WebSocket 재연결 backoff 상한(ms) */
  WS_RECONNECT_MAX_MS: envNum(process.env.NEXT_PUBLIC_WS_RECONNECT_MAX_MS, 10_000),
  /** react-query staleTime(ms) */
  QUERY_STALE_MS: envNum(process.env.NEXT_PUBLIC_QUERY_STALE_MS, 30_000),
} as const;
