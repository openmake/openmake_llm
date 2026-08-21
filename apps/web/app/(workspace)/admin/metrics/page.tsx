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

/* ── 작업 도구 오류 타입 ───────────────────────────────────── */
interface ToolErrorData {
  days: number;
  summary: {
    totalToolExecutions: number;
    errorCount: number;
    errorRate: number;
    affectedTasks: number;
  };
  affectedTaskStatus: { status: string; tasks: number }[];
  topSignatures: { signature: string; count: number }[];
  byToolName: { toolName: string; count: number }[];
}

/* ── 작업 워크플로우 관측 타입 ─────────────────────────────── */
interface WorkflowData {
  days: number;
  completion: {
    completedTasks: number;
    unjudgedTasks: number;
    unjudgedRate: number;
    byVerdict: {
      completionPath: string | null;
      judgeVerdict: string | null;
      tasks: number;
    }[];
  };
  failures: { reason: string; tasks: number }[];
  intervention: {
    totalTasks: number;
    retryTasks: number;
    retryRate: number;
    hitlDegradeTasks: number;
    hitlDegradeRate: number;
  };
  planCoverage: {
    plannedTasks: number;
    totalSteps: number;
    attributedSteps: number;
    coverage: number;
  };
}

/* ── 라우팅 게이트 관측 타입 ───────────────────────────────── */
interface RoutingGatesData {
  days: number;
  orchestration: {
    totalTurns: number;
    intentTurns: number;
    exposedTurns: number;
    calledTurns: number;
    successTurns: number;
    callRate: number;
    successRate: number;
    byTool: { tool: string; turns: number; successTurns: number }[];
    toggles: {
      userMode: string;
      turns: number;
      discussionIntentTurns: number;
      taskDelegateIntentTurns: number;
    }[];
  };
  tailShadow: {
    totalDecisions: number;
    tailDecisions: number;
    tailRate: number;
    labeledDecisions: number;
    groundingFired: number;
    groundingFixed: number;
    lastDecisionAt: string | null;
    byVerifiability: {
      verifiability: string | null;
      decisions: number;
      tailDecisions: number;
    }[];
  };
}

export default function AdminMetricsPage() {
  const t = useTranslations("adminMetrics");
  const locale = toBcp47(useLocale());
  const [updated, setUpdated] = useState<string>("");
  const [nodes, setNodes] = useState<NodeRow[]>(NODES);
  const [cpu, setCpu] = useState<string | null>(null);
  const [mem, setMem] = useState<{ value: string; delta: string } | null>(null);
  const [agentSummary, setAgentSummary] = useState<AgentSummary | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetric[] | null>(null);
  const [toolErrors, setToolErrors] = useState<ToolErrorData | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowData | null>(null);
  const [routingGates, setRoutingGates] = useState<RoutingGatesData | null>(null);
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
      // 작업 도구 오류 로드 (기본 30일)
      const toolErrRes = await ApiClient.get<{ data: ToolErrorData }>(
        "/api/metrics/agent-tasks/tool-errors",
      ).catch(() => null);
      if (toolErrRes?.data) {
        setToolErrors(toolErrRes.data);
      }
      // 작업 워크플로우 관측 로드 (기본 30일)
      const workflowRes = await ApiClient.get<{ data: WorkflowData }>(
        "/api/metrics/agent-tasks/workflow",
      ).catch(() => null);
      if (workflowRes?.data) {
        setWorkflow(workflowRes.data);
      }
      // 라우팅 게이트 관측 로드 (기본 30일)
      const routingRes = await ApiClient.get<{ data: RoutingGatesData }>(
        "/api/metrics/routing/gates",
      ).catch(() => null);
      if (routingRes?.data) {
        setRoutingGates(routingRes.data);
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

        {/* 작업 워크플로우 관측 — 완료 판정·실패 사유·구제 장치·플랜 귀속 */}
        {workflow && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {t("workflow.title", { days: workflow.days })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label={t("workflow.unjudgedRate")}
                  value={`${(workflow.completion.unjudgedRate * 100).toFixed(1)}%`}
                  delta={t("workflow.ofCompleted", {
                    unjudged: workflow.completion.unjudgedTasks.toLocaleString(),
                    completed: workflow.completion.completedTasks.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("workflow.retryRate")}
                  value={`${(workflow.intervention.retryRate * 100).toFixed(1)}%`}
                  delta={t("workflow.ofTasks", {
                    count: workflow.intervention.retryTasks.toLocaleString(),
                    total: workflow.intervention.totalTasks.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("workflow.hitlDegradeRate")}
                  value={`${(workflow.intervention.hitlDegradeRate * 100).toFixed(1)}%`}
                  delta={t("workflow.ofTasks", {
                    count: workflow.intervention.hitlDegradeTasks.toLocaleString(),
                    total: workflow.intervention.totalTasks.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("workflow.planCoverage")}
                  value={`${(workflow.planCoverage.coverage * 100).toFixed(1)}%`}
                  delta={t("workflow.ofSteps", {
                    attributed: workflow.planCoverage.attributedSteps.toLocaleString(),
                    total: workflow.planCoverage.totalSteps.toLocaleString(),
                  })}
                />
              </div>
              {workflow.completion.byVerdict.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("workflow.th.path")}</Th>
                      <Th>{t("workflow.th.verdict")}</Th>
                      <Th className="text-right">{t("workflow.th.tasks")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {workflow.completion.byVerdict.map((v, i) => (
                      <tr key={i}>
                        <Td className="font-mono text-xs text-fg-2">
                          {v.completionPath ?? t("workflow.unrecorded")}
                        </Td>
                        <Td>
                          <Badge
                            tone={
                              v.judgeVerdict === "achieved"
                                ? "success"
                                : v.judgeVerdict === "not_achieved"
                                  ? "danger"
                                  : "warn"
                            }
                          >
                            {v.judgeVerdict ?? t("workflow.unrecorded")}
                          </Badge>
                        </Td>
                        <Td className="text-right font-mono text-fg-2">
                          {v.tasks.toLocaleString()}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {workflow.failures.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {workflow.failures.map((f, i) => (
                    <Badge key={i} tone="danger">
                      {f.reason} · {f.tasks.toLocaleString()}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 라우팅 게이트 관측 — 오케스트레이션 자동 배정·tail 셰도우 */}
        {routingGates && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {t("routing.title", { days: routingGates.days })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label={t("routing.callRate")}
                  value={`${(routingGates.orchestration.callRate * 100).toFixed(1)}%`}
                  delta={t("routing.ofExposed", {
                    called: routingGates.orchestration.calledTurns.toLocaleString(),
                    exposed: routingGates.orchestration.exposedTurns.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("routing.successRate")}
                  value={`${(routingGates.orchestration.successRate * 100).toFixed(1)}%`}
                  delta={t("routing.ofCalled", {
                    success: routingGates.orchestration.successTurns.toLocaleString(),
                    called: routingGates.orchestration.calledTurns.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("routing.tailRate")}
                  value={`${(routingGates.tailShadow.tailRate * 100).toFixed(1)}%`}
                  delta={t("routing.ofDecisions", {
                    tail: routingGates.tailShadow.tailDecisions.toLocaleString(),
                    total: routingGates.tailShadow.totalDecisions.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("routing.lastShadow")}
                  value={
                    routingGates.tailShadow.lastDecisionAt
                      ? new Date(routingGates.tailShadow.lastDecisionAt).toLocaleDateString(locale)
                      : "—"
                  }
                  delta={
                    routingGates.tailShadow.lastDecisionAt
                      ? t("routing.labeled", {
                          labeled: routingGates.tailShadow.labeledDecisions.toLocaleString(),
                        })
                      : t("routing.shadowOff")
                  }
                />
              </div>
              {routingGates.orchestration.toggles.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("routing.th.mode")}</Th>
                      <Th className="text-right">{t("routing.th.turns")}</Th>
                      <Th className="text-right">{t("routing.th.discussionHits")}</Th>
                      <Th className="text-right">{t("routing.th.delegateHits")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {routingGates.orchestration.toggles.map((row) => (
                      <tr key={row.userMode}>
                        <Td className="font-mono text-xs text-fg">{row.userMode}</Td>
                        <Td className="text-right font-mono text-fg-2">
                          {row.turns.toLocaleString()}
                        </Td>
                        <Td className="text-right font-mono text-fg-2">
                          {row.discussionIntentTurns.toLocaleString()}
                        </Td>
                        <Td className="text-right font-mono text-fg-2">
                          {row.taskDelegateIntentTurns.toLocaleString()}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {(routingGates.orchestration.byTool.length > 0 ||
                routingGates.tailShadow.byVerifiability.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {routingGates.orchestration.byTool.map((tool) => (
                    <Badge key={tool.tool} tone="success">
                      {tool.tool} · {tool.successTurns.toLocaleString()}/{tool.turns.toLocaleString()}
                    </Badge>
                  ))}
                  {routingGates.tailShadow.byVerifiability.map((v, i) => (
                    <Badge key={i} tone="warn">
                      {v.verifiability ?? t("workflow.unrecorded")} ·{" "}
                      {v.tailDecisions.toLocaleString()}/{v.decisions.toLocaleString()}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 작업 도구 오류 */}
        {toolErrors && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>
                {t("toolError.title", { days: toolErrors.days })}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label={t("toolError.errorRate")}
                  value={`${(toolErrors.summary.errorRate * 100).toFixed(1)}%`}
                />
                <StatCard
                  label={t("toolError.errorCount")}
                  value={toolErrors.summary.errorCount.toLocaleString()}
                  delta={t("toolError.ofTotal", {
                    total: toolErrors.summary.totalToolExecutions.toLocaleString(),
                  })}
                />
                <StatCard
                  label={t("toolError.affectedTasks")}
                  value={toolErrors.summary.affectedTasks.toLocaleString()}
                />
                <StatCard
                  label={t("toolError.taskStatus")}
                  value={
                    toolErrors.affectedTaskStatus.length > 0
                      ? toolErrors.affectedTaskStatus
                          .map((s) => `${s.status} ${s.tasks}`)
                          .join(" · ")
                      : "—"
                  }
                />
              </div>
              {toolErrors.topSignatures.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("toolError.th.signature")}</Th>
                      <Th className="text-right">{t("toolError.th.count")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolErrors.topSignatures.map((s, i) => (
                      <tr key={i}>
                        <Td className="max-w-0 truncate font-mono text-xs text-fg-2" title={s.signature}>
                          {s.signature}
                        </Td>
                        <Td className="text-right font-mono text-fg-2">
                          {s.count.toLocaleString()}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {toolErrors.byToolName.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {toolErrors.byToolName.map((tool) => (
                    <Badge key={tool.toolName} tone="warn">
                      {tool.toolName} · {tool.count.toLocaleString()}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
