"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Play, Square, Activity, RefreshCw, Loader2 } from "lucide-react";
import {
  Button,
  Badge,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/**
 * MCP 인스턴스 상태 패널 — 프로세스 lifecycle(시작·중지·pid 헬스체크) 관리.
 *
 * 구 SPA(`pages/mcp-servers.js`)의 "인스턴스 상태" 탭이 2026-06-21 Next.js 이전 때
 * 이식되지 않아 백엔드 lifecycle API 전체가 UI 없이 남아 있던 것을 복원한 것.
 *
 * ⚠️ 커넥터 탭의 연결/해제(connect/disconnect = MCP 클라이언트 세션)와 다른 축이다.
 *    여기의 시작/중지는 lifecycle-supervisor 의 프로세스 spawn/kill 이다.
 */

/** 자동 갱신 주기 — 구 SPA 와 동일(15초). */
const POLL_INTERVAL_MS = 15_000;

interface McpInstanceRow {
  id: number;
  mcp_server_id: string;
  user_id: string;
  pid: number | null;
  status: "starting" | "running" | "stopped" | "crashed";
  started_at: string;
  stopped_at: string | null;
  last_error: string | null;
}

interface InstanceMetrics {
  currentRunning: number;
  totalSpawned: number;
  crashed24h: number;
  avgUptimeSec: number | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

interface HealthCheckResult {
  verified: number;
  declaredDead: number;
  missingPid: number;
}

const STATUS_TONE: Record<McpInstanceRow["status"], "success" | "danger" | "warn" | "neutral"> = {
  running: "success",
  starting: "warn",
  stopped: "neutral",
  crashed: "danger",
};

function fmtDateTime(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function McpInstancesPanel({ servers }: { servers: Array<{ id: string; name: string }> }) {
  const t = useTranslations("mcpInstances");
  const [selected, setSelected] = useState<string>("");
  const [instances, setInstances] = useState<McpInstanceRow[]>([]);
  const [metrics, setMetrics] = useState<InstanceMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (serverId: string, quiet = false) => {
    if (!serverId) return;
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const [instRes, metricsRes] = await Promise.all([
        ApiClient.get<ApiEnvelope<{ instances: McpInstanceRow[] }>>(
          `/api/mcp/servers/${encodeURIComponent(serverId)}/instances`,
        ),
        ApiClient.get<ApiEnvelope<{ metrics: InstanceMetrics }>>(
          `/api/mcp/servers/${encodeURIComponent(serverId)}/metrics`,
        ),
      ]);
      setInstances(instRes?.data?.instances ?? []);
      setMetrics(metricsRes?.data?.metrics ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!selected) {
      setInstances([]);
      setMetrics(null);
      return;
    }
    void load(selected);
  }, [selected, load]);

  // 선택된 서버가 있을 때만 주기 갱신 (조용히 — 스피너 깜빡임 방지)
  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => {
      void load(selected, true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [selected, load]);

  async function lifecycle(action: "start" | "stop") {
    if (!selected) return;
    if (action === "stop" && !window.confirm(t("confirmStop"))) return;
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      await ApiClient.post(`/api/mcp/servers/${encodeURIComponent(selected)}/${action}`, {});
      setNotice(action === "start" ? t("startRequested") : t("stopRequested"));
      await load(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionError"));
    } finally {
      setActing(false);
    }
  }

  async function healthCheck() {
    if (!selected) return;
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await ApiClient.post<ApiEnvelope<{ result: HealthCheckResult }>>(
        `/api/mcp/servers/${encodeURIComponent(selected)}/instances/health-check`,
        {},
      );
      const r = res?.data?.result;
      if (r) {
        setNotice(t("healthResult", {
          verified: r.verified,
          dead: r.declaredDead,
          missing: r.missingPid,
        }));
      }
      await load(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* 툴바 — 서버 선택 + lifecycle 액션 */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label={t("selectServer")}
          className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-fg"
        >
          <option value="">{t("selectServer")}</option>
          {servers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <Button size="sm" disabled={!selected || acting} onClick={() => void lifecycle("start")}>
          {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {t("start")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || acting}
          onClick={() => void lifecycle("stop")}
        >
          <Square className="h-3 w-3" />
          {t("stop")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || acting}
          onClick={() => void healthCheck()}
          title={t("healthCheckTitle")}
        >
          <Activity className="h-3 w-3" />
          {t("healthCheck")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || loading}
          onClick={() => void load(selected)}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {t("refresh")}
        </Button>
        <span className="ml-auto text-xs text-faint">{t("autoRefresh")}</span>
      </div>

      {notice && (
        <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-2">{notice}</p>
      )}
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}

      {/* 집계 지표 */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            ["metricRunning", metrics.currentRunning],
            ["metricSpawned", metrics.totalSpawned],
            ["metricCrashed", metrics.crashed24h],
            ["metricUptime", metrics.avgUptimeSec != null ? `${Math.round(metrics.avgUptimeSec)}s` : "—"],
          ] as const).map(([key, value]) => (
            <div key={key} className="rounded-md border border-border bg-surface-2 px-3 py-2">
              <p className="text-[11px] text-muted">{t(key)}</p>
              <p className="font-mono text-lg text-fg">{value}</p>
            </div>
          ))}
        </div>
      )}
      {metrics?.lastErrorMessage && (
        <p className="text-[11px] text-faint">
          {t("lastError", {
            at: fmtDateTime(metrics.lastErrorAt),
            message: metrics.lastErrorMessage,
          })}
        </p>
      )}

      {/* 인스턴스 이력 */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <thead>
            <tr>
              <Th>{t("colStatus")}</Th>
              <Th className="text-right">{t("colPid")}</Th>
              <Th>{t("colStarted")}</Th>
              <Th>{t("colStopped")}</Th>
              <Th>{t("colError")}</Th>
            </tr>
          </thead>
          <tbody>
            {!selected ? (
              <tr>
                <Td colSpan={5}>
                  <div className="py-10 text-center text-sm text-muted">{t("pickServer")}</div>
                </Td>
              </tr>
            ) : instances.length === 0 ? (
              <tr>
                <Td colSpan={5}>
                  <div className="py-10 text-center text-sm text-muted">{t("empty")}</div>
                </Td>
              </tr>
            ) : (
              instances.map((i) => (
                <tr key={i.id}>
                  <Td><Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge></Td>
                  <Td className="text-right font-mono">{i.pid ?? "—"}</Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{fmtDateTime(i.started_at)}</Td>
                  <Td className="whitespace-nowrap font-mono text-xs">{fmtDateTime(i.stopped_at)}</Td>
                  <Td className="max-w-[280px]">
                    {i.last_error
                      ? <span className="block truncate text-danger" title={i.last_error}>{i.last_error}</span>
                      : <span className="text-faint">—</span>}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
