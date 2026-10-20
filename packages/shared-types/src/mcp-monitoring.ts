/**
 * 관리자 MCP 모니터링 API 계약 — GET /api/admin/mcp/monitoring/{summary,top-crashed,crash-trend}.
 * 응답은 공통 `{ success, data }` 봉투 안의 data 모양이다. 원천은 mcp_server_instances 라이프사이클 기록
 * (상태 전이마다 한 줄 — 연결 한 번에 starting·running 두 줄)이라 도구 호출 수가 아니다.
 */

/** data.summary */
export interface McpMonitoringSummary {
  /** 등록된 서버 정의 수(mcp_servers). */
  totalServers: number;
  /** 라이프사이클 기록이 있는 사용자 수. */
  totalUsers: number;
  /** (서버, 사용자) 쌍별 최신 기록 상태가 running 인 쌍 수 — totalServers 와 다른 모집단. */
  currentRunning: number;
  /** 보존된 라이프사이클 기록 전체 행 수. */
  totalSpawned: number;
  /** 최근 24시간 crashed 기록 수. */
  crashed24h: number;
  /** 최근 24시간 crashed 기록 ÷ 최근 24시간 전체 기록 × 100. 기록이 없으면 null. */
  crashRate24hPct: number | null;
}

/** data.items[] — 최근 7일 crashed 기록 수 내림차순. */
export interface McpTopCrashedServer {
  mcp_server_id: string;
  name: string;
  user_id: string | null;
  visibility: string;
  crash_count: number;
  last_crash_at: string | null;
}

/** data.timeline[] — 현재 시각 포함 24개 시간대. spawned 는 그 시간대 라이프사이클 기록 수. */
export interface McpCrashTrendBucket {
  hour: string;
  spawned: number;
  crashed: number;
}
