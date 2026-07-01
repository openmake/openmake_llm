"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { CLIENT_TIMING } from "@/lib/config";
import {
  Button,
  Badge,
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 백엔드 응답 타입 (admin 전용) ───────────────────────── */
interface ApiMonitoringSummary {
  totalServers: number;
  totalUsers: number;
  currentRunning: number;
  totalSpawned: number;
  crashed24h: number;
  crashRate24hPct: number | null;
}

interface SummaryView {
  activeServers: string;
  totalCalls: string;
  avgLatency: string;
  errorRate: string;
}

/* ── 추가 타입 ───────────────────────────────────────────── */
interface TopCrashedItem {
  server_name: string;
  crash_count: number;
  last_crash_at: string;
}

interface CrashTrendItem {
  hour: string;
  spawned: number;
  crashed: number;
}

/* ── 타입 ────────────────────────────────────────────────── */
interface ServerUsage {
  name: string;
  calls: number;
  errorRate: number; // 0~1
}

type LogStatus = "success" | "error";

interface ToolLog {
  id: number;
  time: string;
  server: string;
  tool: string;
  durationMs: number;
  status: LogStatus;
}

/* ── 목업 데이터 ──────────────────────────────────────────
 * 요약 StatCard 4개 중 "활성 서버"·"총 spawn(=총 도구 호출 칸)"·"에러율" 은
 * GET /api/admin/mcp/monitoring/summary 로 실연동. "평균 지연" 은 백엔드에
 * 해당 메트릭이 없어 목업 유지. 서버별 호출 분포·도구 실행 로그는 백엔드에
 * per-call/per-tool 집계 엔드포인트가 없어 목업 유지. (아래 주석 참조)
 */
const SUMMARY: SummaryView = {
  activeServers: "4",
  totalCalls: "12,840",
  avgLatency: "186ms",
  errorRate: "1.4%",
};

const SERVER_USAGE: ServerUsage[] = [
  { name: "github", calls: 5210, errorRate: 0.008 },
  { name: "filesystem", calls: 4120, errorRate: 0.002 },
  { name: "slack-events", calls: 2380, errorRate: 0.021 },
  { name: "postgres-prod", calls: 980, errorRate: 0.064 },
  { name: "weather-api", calls: 150, errorRate: 0.12 },
];

const LOGS: ToolLog[] = [
  {
    id: 1,
    time: "14:32:08",
    server: "github",
    tool: "search_issues",
    durationMs: 212,
    status: "success",
  },
  {
    id: 2,
    time: "14:31:55",
    server: "filesystem",
    tool: "read_file",
    durationMs: 9,
    status: "success",
  },
  {
    id: 3,
    time: "14:31:40",
    server: "postgres-prod",
    tool: "query",
    durationMs: 1240,
    status: "error",
  },
  {
    id: 4,
    time: "14:31:12",
    server: "slack-events",
    tool: "send_message",
    durationMs: 84,
    status: "success",
  },
  {
    id: 5,
    time: "14:30:58",
    server: "github",
    tool: "create_pr",
    durationMs: 340,
    status: "success",
  },
  {
    id: 6,
    time: "14:30:31",
    server: "weather-api",
    tool: "get_forecast",
    durationMs: 0,
    status: "error",
  },
];

const maxCalls = Math.max(...SERVER_USAGE.map((s) => s.calls));

/** 요약 통계 조회 — 실패(401/네트워크) 시 null 반환하여 호출측이 목업 유지. */
async function fetchSummaryView(): Promise<SummaryView | null> {
  try {
    const res = await ApiClient.get<
      ApiEnvelope<{ summary: ApiMonitoringSummary }>
    >("/api/admin/mcp/monitoring/summary");
    const s = res?.data?.summary;
    if (!s) return null;
    return {
      activeServers: String(s.currentRunning),
      // 백엔드엔 "총 도구 호출" 메트릭이 없어 누적 spawn 수로 대체 표시
      totalCalls: s.totalSpawned.toLocaleString("ko-KR"),
      // 평균 지연 메트릭 없음 — 목업 값 유지
      avgLatency: SUMMARY.avgLatency,
      errorRate:
        s.crashRate24hPct != null ? `${s.crashRate24hPct.toFixed(1)}%` : "—",
    };
  } catch {
    // 401(비admin)·실패 → null (목업 유지)
    return null;
  }
}

export default function McpMonitoringPage() {
  const t = useTranslations("mcpMonitoring");
  const [summary, setSummary] = useState<SummaryView>(SUMMARY);
  const [topCrashed, setTopCrashed] = useState<TopCrashedItem[]>([]);
  const [crashTrend, setCrashTrend] = useState<CrashTrendItem[]>([]);

  async function loadExtraStats() {
    try {
      const [tc, ct] = await Promise.allSettled([
        ApiClient.get<ApiEnvelope<{ items: TopCrashedItem[]; limit: number }>>(
          "/api/admin/mcp/monitoring/top-crashed?limit=10",
        ),
        ApiClient.get<ApiEnvelope<{ timeline: CrashTrendItem[] }>>(
          "/api/admin/mcp/monitoring/crash-trend",
        ),
      ]);
      if (tc.status === "fulfilled") setTopCrashed(tc.value?.data?.items ?? []);
      if (ct.status === "fulfilled") setCrashTrend(ct.value?.data?.timeline ?? []);
    } catch {
      /* 비관리자/실패 시 빈 상태 유지 */
    }
  }

  const refresh = useCallback(async () => {
    const view = await fetchSummaryView();
    if (view) setSummary(view);
    await loadExtraStats();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const view = await fetchSummaryView();
      if (!cancelled && view) setSummary(view);
    };
    void tick();
    void loadExtraStats();
    const id = setInterval(() => void tick(), CLIENT_TIMING.MCP_MONITORING_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-4 w-4" />
            {t("refresh")}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={t("activeServers")}
            value={summary.activeServers}
            delta={t("activeServersDelta")}
          />
          <StatCard
            label={t("totalCalls")}
            value={summary.totalCalls}
            delta="+8.2% 24h"
            deltaTone="success"
          />
          <StatCard label={t("avgLatency")} value={summary.avgLatency} />
          <StatCard
            label={t("errorRate")}
            value={summary.errorRate}
            delta="+0.3% 24h"
            deltaTone="danger"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
          {/* 서버별 호출 추이 — 순수 CSS 바 차트.
              백엔드에 per-server 호출/에러율 집계 엔드포인트가 없어 목업 유지. */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("serverDistribution")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {SERVER_USAGE.map((s) => {
                const pct = (s.calls / maxCalls) * 100;
                const highErr = s.errorRate >= 0.05;
                return (
                  <div key={s.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-mono text-fg-2">{s.name}</span>
                      <span className="text-faint">
                        {t("callCount", { count: s.calls.toLocaleString("ko-KR") })} ·{" "}
                        <span className={highErr ? "text-danger" : "text-muted"}>
                          {(s.errorRate * 100).toFixed(1)}%
                        </span>
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-pill bg-surface-2">
                      <div
                        className={
                          "h-full rounded-pill " +
                          (highErr ? "bg-warn" : "bg-accent")
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* 최근 도구 실행 로그.
              백엔드에 per-tool 실행 로그 엔드포인트가 없어 목업 유지. */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>{t("recentToolLog")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("colTime")}</Th>
                    <Th>{t("colServer")}</Th>
                    <Th>{t("colTool")}</Th>
                    <Th className="text-right">{t("colDuration")}</Th>
                    <Th>{t("colStatus")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {LOGS.map((l) => (
                    <tr key={l.id} className="transition hover:bg-surface-2">
                      <Td className="font-mono text-faint">{l.time}</Td>
                      <Td className="font-mono text-fg-2">{l.server}</Td>
                      <Td className="font-mono text-fg-2">{l.tool}</Td>
                      <Td className="text-right font-mono">
                        {l.status === "error" ? (
                          <span className="text-faint">—</span>
                        ) : (
                          `${l.durationMs}ms`
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={l.status === "success" ? "success" : "danger"}
                        >
                          {l.status === "success" ? t("statusSuccess") : t("statusError")}
                        </Badge>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {/* M5: Top 크래시 서버 + 크래시 추이 */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("topCrashed")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topCrashed.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">{t("noData")}</p>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("colServer")}</Th>
                      <Th className="text-right">{t("colCrashCount")}</Th>
                      <Th>{t("colLastCrash")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCrashed.map((item) => (
                      <tr key={item.server_name} className="transition hover:bg-surface-2">
                        <Td>
                          <div className="flex items-center gap-2">
                            <AlertTriangle className="h-3.5 w-3.5 text-warn" />
                            <span className="font-mono text-xs text-fg-2">{item.server_name}</span>
                          </div>
                        </Td>
                        <Td className="text-right font-mono text-danger">{item.crash_count}</Td>
                        <Td className="text-xs text-muted">
                          {item.last_crash_at
                            ? new Date(item.last_crash_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("crashTrend")}</CardTitle>
            </CardHeader>
            <CardContent>
              {crashTrend.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">{t("noData")}</p>
              ) : (
                <div className="space-y-2">
                  {crashTrend.map((item) => {
                    const maxVal = Math.max(...crashTrend.map((t) => t.spawned), 1);
                    const spawnedPct = (item.spawned / maxVal) * 100;
                    const crashedPct = item.spawned > 0 ? (item.crashed / item.spawned) * 100 : 0;
                    return (
                      <div key={item.hour}>
                        <div className="mb-0.5 flex items-center justify-between text-[11px]">
                          <span className="font-mono text-muted">{item.hour}</span>
                          <span className="text-faint">
                            spawn {item.spawned} ·{" "}
                            <span className={item.crashed > 0 ? "text-danger" : "text-muted"}>
                              crash {item.crashed}
                            </span>
                          </span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-pill bg-surface-2">
                          <div
                            className="absolute inset-y-0 left-0 rounded-pill bg-accent opacity-60"
                            style={{ width: `${spawnedPct}%` }}
                          />
                          {item.crashed > 0 && (
                            <div
                              className="absolute inset-y-0 left-0 rounded-pill bg-danger"
                              style={{ width: `${crashedPct * spawnedPct / 100}%` }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
