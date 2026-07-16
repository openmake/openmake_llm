"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toBcp47 } from "@/i18n/config";
import { Gauge, RefreshCw } from "lucide-react";
import {
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { AdminTabs } from "@/components/hub-tabs";

type NodeStatus = "online" | "degraded" | "offline";

interface NodeRow {
  name: string;
  role: string;
  status: NodeStatus;
  latency: string;
  load: string;
}

const STATUS_TONE: Record<NodeStatus, "success" | "warn" | "danger"> = {
  online: "success",
  degraded: "warn",
  offline: "danger",
};
const STATUS_LABEL_KEY: Record<NodeStatus, string> = {
  online: "status.online",
  degraded: "status.degraded",
  offline: "status.offline",
};

// 클러스터 노드/CPU/메모리는 /api/metrics·/api/metrics/metrics 실데이터로 오버레이.
// 요청률 24h 시계열·요청률/에러율 StatCard 는 백엔드 시계열 미제공(usage-tracker stub)이라 목업 유지.
const NODES: NodeRow[] = [
  { name: "vllm-qwen-262k", role: "LLM · 262K", status: "online", latency: "0.82s", load: "61%" },
  { name: "vllm-bge-m3", role: "Embedding", status: "online", latency: "0.04s", load: "23%" },
  { name: "litellm-proxy", role: "Proxy :13401", status: "online", latency: "0.01s", load: "12%" },
  { name: "postgres-primary", role: "Database", status: "online", latency: "0.6ms", load: "34%" },
  { name: "redis-kv", role: "KV / Rate-limit", status: "degraded", latency: "1.2ms", load: "78%" },
  { name: "api-server-2", role: "API (PM2)", status: "online", latency: "12ms", load: "44%" },
];

// 24시간 요청률 시계열 (req/min)
const TIMESERIES = Array.from({ length: 24 }, (_, h) => ({
  hour: h,
  value: 120 + Math.round(Math.abs(Math.sin((h - 4) / 3) * 480) + (h >= 9 && h <= 18 ? 220 : 0)),
}));

type Cat = { id?: string; name?: string; status?: string; latency?: number | string };

/* ── 에이전트 메트릭 타입 ───────────────────────────────────── */
interface AgentMetric {
  agentId: string;
  requests: number;
  successCount: number;
  totalResponseTime: number;
  totalTokens: number;
}
interface AgentSummary {
  totalAgents: number;
  totalRequests: number;
  avgSuccessRate: number;
  avgResponseTime: number;
  mostUsedAgent: string | null;
}

const STATUS_MAP: Record<string, NodeStatus> = {
  online: "online",
  offline: "offline",
  busy: "degraded",
  unknown: "degraded",
};

export default function AdminMetricsPage() {
  const t = useTranslations("adminMetrics");
  const locale = toBcp47(useLocale());
  const [updated, setUpdated] = useState<string>("");
  const [nodes, setNodes] = useState<NodeRow[]>(NODES);
  const [cpu, setCpu] = useState<string | null>(null);
  const [mem, setMem] = useState<{ value: string; delta: string } | null>(null);
  const [agentSummary, setAgentSummary] = useState<AgentSummary | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetric[] | null>(null);
  const maxV = Math.max(...TIMESERIES.map((t) => t.value));

  const load = useCallback(async () => {
    try {
      const [m, detail] = await Promise.allSettled([
        // GET /api/metrics → { data: { cluster: { nodes: [...] } } }
        ApiClient.get<{ data?: { cluster?: { nodes?: Cat[] } } }>("/api/metrics"),
        // GET /api/metrics/metrics → { data: { system: { cpu, memory } } }
        ApiClient.get<{
          data?: {
            system?: {
              cpu?: { cores?: number; loadAvg?: number[] };
              memory?: { used?: number; total?: number; percentage?: number };
            };
          };
        }>("/api/metrics/metrics"),
      ]);

      if (m.status === "fulfilled") {
        const list = m.value.data?.cluster?.nodes ?? [];
        if (list.length) {
          setNodes(
            list.map((n) => ({
              name: n.name ?? n.id ?? "node",
              role: t("nodeRoleLlm"),
              status: STATUS_MAP[String(n.status)] ?? "degraded",
              latency:
                typeof n.latency === "number" ? `${n.latency}ms` : (n.latency ?? "-"),
              load: "-", // 백엔드 미제공
            })),
          );
        }
      }

      if (detail.status === "fulfilled" && detail.value.data?.system) {
        const sys = detail.value.data.system;
        const cores = sys.cpu?.cores ?? 0;
        const load1 = sys.cpu?.loadAvg?.[0];
        if (load1 != null && cores > 0) {
          setCpu(`${Math.min(100, Math.round((load1 / cores) * 100))}%`);
        }
        if (sys.memory?.used != null && sys.memory?.total != null) {
          setMem({
            value: `${(sys.memory.used / 1024).toFixed(1)} GB`,
            delta: t("memoryDelta", { total: (sys.memory.total / 1024).toFixed(1) }),
          });
        }
      }
      // 에이전트 메트릭 로드
      const [agentSummaryRes, agentMetricsRes] = await Promise.allSettled([
        // 백엔드 응답 형태: { totalRequests, totalSuccess, totalFailures, avgResponseTime, byAgent }.
        // 프론트 AgentSummary(totalAgents/avgSuccessRate)로 매핑한다 — 미매핑 시 undefined/NaN 노출.
        ApiClient.get<{ data: { summary: { totalRequests: number; totalSuccess: number; totalFailures: number; avgResponseTime: number; byAgent: Record<string, unknown> } } }>("/api/agents-monitoring/summary"),
        ApiClient.get<{ data: { metrics: Record<string, AgentMetric> } }>("/api/agents-monitoring/metrics"),
      ]);
      if (agentSummaryRes.status === "fulfilled") {
        const s = agentSummaryRes.value?.data?.summary;
        setAgentSummary(
          s
            ? {
                totalAgents: s.byAgent ? Object.keys(s.byAgent).length : 0,
                totalRequests: s.totalRequests ?? 0,
                avgSuccessRate: (s.totalRequests ?? 0) > 0 ? (s.totalSuccess ?? 0) / s.totalRequests : 0,
                avgResponseTime: s.avgResponseTime ?? 0,
                mostUsedAgent: null,
              }
            : null,
        );
      }
      if (agentMetricsRes.status === "fulfilled") {
        const raw = agentMetricsRes.value?.data?.metrics;
        if (raw) {
          setAgentMetrics(Object.values(raw));
        }
      }
    } catch {
      /* 401/실패 시 목업 유지 */
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setUpdated(new Date().toLocaleTimeString(locale));
    void load();
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={updated ? t("lastUpdated", { time: updated }) : t("subtitle")}
        actions={
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
          </Button>
        }
      />
      <AdminTabs />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* CPU·메모리는 실 시스템 지표. 요청률/에러율은 이 페이지에 실 소스가 없어
              가짜 값(612/min·0.21%)+델타를 제거하고 "—"(데이터 없음)로 표시. */}
          <StatCard label={t("stat.cpu")} value={cpu ?? "—"} delta="load avg / cores" deltaTone="success" />
          <StatCard label={t("stat.memory")} value={mem?.value ?? "—"} delta={mem?.delta ?? t("memoryDelta", { total: "16" })} />
          <StatCard label={t("stat.requestRate")} value="—" />
          <StatCard label={t("stat.errorRate")} value="—" />
        </div>

        <Card className="mt-6">
          <CardHeader className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-accent" />
            <CardTitle>{t("requestChartTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-1">
              {TIMESERIES.map((bar) => (
                <div
                  key={bar.hour}
                  className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                  title={t("barTooltip", { hour: String(bar.hour).padStart(2, "0"), value: bar.value })}
                >
                  <div
                    className="w-full rounded-t bg-accent/70 transition group-hover:bg-accent"
                    style={{ height: `${Math.max(4, (bar.value / maxV) * 100)}%` }}
                  />
                  {bar.hour % 3 === 0 && (
                    <span className="text-[9px] text-faint">{String(bar.hour).padStart(2, "0")}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("nodeStatusTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t("th.node")}</Th>
                  <Th>{t("th.role")}</Th>
                  <Th>{t("th.status")}</Th>
                  <Th>{t("th.latency")}</Th>
                  <Th>{t("th.load")}</Th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.name}>
                    <Td className="font-mono text-xs text-fg">{n.name}</Td>
                    <Td className="text-muted">{n.role}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[n.status]}>{t(STATUS_LABEL_KEY[n.status])}</Badge>
                    </Td>
                    <Td className="font-mono text-xs text-fg-2">{n.latency}</Td>
                    <Td className="font-mono text-xs text-fg-2">{n.load}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
        {/* 에이전트 메트릭 */}
        {(agentSummary || (agentMetrics && agentMetrics.length > 0)) && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("agentMetricsTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {agentSummary && (
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatCard
                    label={t("agent.totalAgents")}
                    value={String(agentSummary.totalAgents)}
                  />
                  <StatCard
                    label={t("agent.totalRequests")}
                    value={agentSummary.totalRequests.toLocaleString()}
                  />
                  <StatCard
                    label={t("agent.avgSuccessRate")}
                    value={`${(agentSummary.avgSuccessRate * 100).toFixed(1)}%`}
                  />
                  <StatCard
                    label={t("agent.avgResponseTime")}
                    value={`${Math.round(agentSummary.avgResponseTime)}ms`}
                  />
                </div>
              )}
              {agentMetrics && agentMetrics.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("agentTh.id")}</Th>
                      <Th className="text-right">{t("agentTh.requests")}</Th>
                      <Th className="text-right">{t("agentTh.successRate")}</Th>
                      <Th className="text-right">{t("agentTh.avgResponseTime")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {agentMetrics.map((m) => {
                      const successRate =
                        m.requests > 0
                          ? Math.round((m.successCount / m.requests) * 100)
                          : 0;
                      const avgRt =
                        m.requests > 0
                          ? Math.round(m.totalResponseTime / m.requests)
                          : 0;
                      return (
                        <tr key={m.agentId}>
                          <Td className="font-mono text-xs text-fg">{m.agentId}</Td>
                          <Td className="text-right font-mono text-fg-2">
                            {m.requests.toLocaleString()}
                          </Td>
                          <Td className="text-right font-mono text-fg-2">
                            {successRate}%
                          </Td>
                          <Td className="text-right font-mono text-fg-2">
                            {avgRt}ms
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
