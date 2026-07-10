"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { LineChart } from "lucide-react";
import {
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
import { cn } from "@/lib/utils";
import { ApiClient } from "@/lib/api-client";

type Period = "7d" | "30d" | "90d";
const PERIODS: { key: Period; labelKey: string }[] = [
  { key: "7d", labelKey: "period.7d" },
  { key: "30d", labelKey: "period.30d" },
  { key: "90d", labelKey: "period.90d" },
];

// 일별 대화량/모델 비중 실데이터: /api/metrics/analytics/daily-conversations,
// /api/metrics/analytics/model-usage (conversation_messages 집계). 실패 시 아래 목업 유지.
const DAILY: Record<Period, { label: string; value: number }[]> = {
  "7d": [
    { label: "weekday.1", value: 3120 },
    { label: "weekday.2", value: 4280 },
    { label: "weekday.3", value: 3890 },
    { label: "weekday.4", value: 5210 },
    { label: "weekday.5", value: 4820 },
    { label: "weekday.6", value: 2310 },
    { label: "weekday.0", value: 1980 },
  ],
  "30d": Array.from({ length: 30 }, (_, i) => ({
    label: `${i + 1}`,
    value: 2000 + Math.round(Math.abs(Math.sin(i / 3) * 4200)),
  })),
  "90d": Array.from({ length: 90 }, (_, i) => ({
    label: `${i + 1}`,
    value: 1800 + Math.round(Math.abs(Math.cos(i / 6) * 5200)),
  })),
};

const SUMMARY: Record<Period, { conv: string; users: string; tokens: string; latency: string }> = {
  "7d": { conv: "26,610", users: "318", tokens: "48.2M", latency: "1.12s" },
  "30d": { conv: "112,940", users: "1,042", tokens: "214.7M", latency: "1.20s" },
  "90d": { conv: "318,500", users: "1,510", tokens: "642.1M", latency: "1.18s" },
};

// 모델 프로파일별 사용 비중 목업 (실데이터 실패 시 폴백).
const MODEL_USAGE = [
  { name: "Default", pct: 34, color: "bg-m-default" },
  { name: "Pro", pct: 21, color: "bg-m-pro" },
  { name: "Fast", pct: 16, color: "bg-m-fast" },
  { name: "Think", pct: 12, color: "bg-m-think" },
  { name: "Code", pct: 9, color: "bg-m-code" },
  { name: "Vision", pct: 5, color: "bg-m-vision" },
  { name: "Auto", pct: 3, color: "bg-m-auto" },
];

/* 모델명 → 모델색 매핑 (usage 페이지와 동일 규칙) */
const MODEL_BAR: Record<string, string> = {
  default: "bg-m-default",
  pro: "bg-m-pro",
  fast: "bg-m-fast",
  think: "bg-m-think",
  code: "bg-m-code",
  vision: "bg-m-vision",
  auto: "bg-m-auto",
};
function modelBar(name: string): string {
  const key = Object.keys(MODEL_BAR).find((k) => name.toLowerCase().includes(k));
  return MODEL_BAR[key ?? "auto"];
}

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

const PERIOD_DAYS: Record<Period, number> = { "7d": 7, "30d": 30, "90d": 90 };
const WEEKDAY_KEYS = ["weekday.0", "weekday.1", "weekday.2", "weekday.3", "weekday.4", "weekday.5", "weekday.6"];

/* ── 비용/행동/에이전트 섹션 타입 ──────────────────────────── */
interface CostData {
  dailyCost: number;
  weeklyCost: number;
  projectedMonthlyCost: number;
  costByModel: { model: string; cost: number; percentage: number }[];
}
interface BehaviorData {
  peakHours: { hour: number; requests: number }[];
  avgSessionLength: number;
  topQueries: { query: string; count: number }[];
  avgQueriesPerSession: number;
}
interface AgentRow {
  agentId: string;
  agentName: string;
  totalRequests: number;
  avgResponseTime: number;
  successRate: number;
  avgTokens: number;
  popularity: number;
}

function fmtCost(n: number) { return `$${n.toFixed(4)}`; }

export default function AdminAnalyticsPage() {
  const t = useTranslations("adminAnalytics");
  const [period, setPeriod] = useState<Period>("7d");
  // 실데이터 오버레이 (가능한 지표만): null 이면 목업 SUMMARY 사용
  const [liveUsers, setLiveUsers] = useState<string | null>(null);
  const [liveTokens, setLiveTokens] = useState<string | null>(null);
  // 실데이터 차트: null 이면 목업 DAILY / MODEL_USAGE 사용
  const [liveDaily, setLiveDaily] = useState<{ label: string; value: number }[] | null>(null);
  const [liveModels, setLiveModels] = useState<{ name: string; pct: number; color: string }[] | null>(null);
  // 추가 섹션 데이터
  const [costData, setCostData] = useState<CostData | null>(null);
  const [behaviorData, setBehaviorData] = useState<BehaviorData | null>(null);
  const [agentsData, setAgentsData] = useState<AgentRow[] | null>(null);

  const daily =
    liveDaily ??
    (period === "7d"
      ? DAILY["7d"].map((d) => ({ ...d, label: t(d.label) }))
      : DAILY[period]);
  const sum = SUMMARY[period];
  const models = liveModels ?? MODEL_USAGE;
  const maxVal = useMemo(() => Math.max(1, ...daily.map((d) => d.value)), [daily]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [us, mt] = await Promise.allSettled([
          // GET /api/admin/users/stats → { data: { activeUsers, ... } }
          ApiClient.get<{ data?: { activeUsers?: number } }>("/api/admin/users/stats"),
          // GET /api/metrics → { data: { usage: { weekly: { totalTokens } } } }
          ApiClient.get<{ data?: { usage?: { weekly?: { totalTokens?: number } } } }>("/api/metrics"),
        ]);
        if (!alive) return;
        if (us.status === "fulfilled" && us.value.data?.activeUsers != null) {
          setLiveUsers(us.value.data.activeUsers.toLocaleString());
        }
        if (mt.status === "fulfilled" && mt.value.data?.usage?.weekly?.totalTokens != null) {
          setLiveTokens(fmtTokens(mt.value.data.usage.weekly.totalTokens));
        }
      } catch {
        /* 401/실패 시 목업 유지 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 비용/행동/에이전트 데이터 로드 (마운트 1회)
  useEffect(() => {
    let alive = true;
    (async () => {
      const [costRes, behaviorRes, agentsRes] = await Promise.allSettled([
        ApiClient.get<{ data: CostData }>("/api/metrics/analytics/cost"),
        ApiClient.get<{ data: BehaviorData }>("/api/metrics/analytics/behavior"),
        ApiClient.get<{ data: AgentRow[] }>("/api/metrics/analytics/agents"),
      ]);
      if (!alive) return;
      if (costRes.status === "fulfilled") setCostData(costRes.value?.data ?? null);
      if (behaviorRes.status === "fulfilled") setBehaviorData(behaviorRes.value?.data ?? null);
      if (agentsRes.status === "fulfilled") setAgentsData(agentsRes.value?.data ?? null);
    })();
    return () => { alive = false; };
  }, []);

  // 기간별 일별 대화량 + 모델 비중 실데이터 로드
  useEffect(() => {
    let alive = true;
    const days = PERIOD_DAYS[period];
    (async () => {
      try {
        const [dc, mu] = await Promise.allSettled([
          ApiClient.get<{ data?: { daily?: { date: string; messages: number }[] } }>(
            `/api/metrics/analytics/daily-conversations?days=${days}`,
          ),
          ApiClient.get<{ data?: { models?: { model: string; count: number }[] } }>(
            `/api/metrics/analytics/model-usage?days=${days}`,
          ),
        ]);
        if (!alive) return;

        if (dc.status === "fulfilled" && Array.isArray(dc.value.data?.daily)) {
          const rows = dc.value.data!.daily!;
          setLiveDaily(
            rows.map((r) => ({
              label:
                period === "7d"
                  ? t(WEEKDAY_KEYS[new Date(r.date).getDay()])
                  : r.date.slice(5),
              value: Number(r.messages),
            })),
          );
        } else {
          setLiveDaily(null);
        }

        if (mu.status === "fulfilled" && Array.isArray(mu.value.data?.models)) {
          const rows = mu.value.data!.models!;
          const total = rows.reduce((a, r) => a + Number(r.count), 0);
          setLiveModels(
            total > 0
              ? rows.map((r) => ({
                  name: r.model,
                  pct: Math.round((Number(r.count) / total) * 100),
                  color: modelBar(r.model),
                }))
              : null,
          );
        } else {
          setLiveModels(null);
        }
      } catch {
        if (alive) {
          setLiveDaily(null);
          setLiveModels(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [period, t]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-1 rounded-pill border border-border bg-surface-2 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-pill px-3 py-1 text-xs font-medium transition",
                  period === p.key
                    ? "bg-surface text-fg shadow-1"
                    : "text-muted hover:text-fg",
                )}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* 값은 실데이터. 트렌드 델타는 실 비교 소스가 없어 제거(가짜 표시 방지). */}
          <StatCard label={t("stats.totalConversations")} value={sum.conv} />
          <StatCard label={t("stats.activeUsers")} value={liveUsers ?? sum.users} />
          <StatCard label={t("stats.consumedTokens")} value={liveTokens ?? sum.tokens} />
          <StatCard label={t("stats.avgResponse")} value={sum.latency} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>{t("dailyConversations")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-56 items-end gap-1.5">
                {daily.map((d, i) => (
                  <div key={i} className="group flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                    <span className="text-[10px] font-medium text-faint opacity-0 transition group-hover:opacity-100">
                      {d.value.toLocaleString()}
                    </span>
                    <div
                      className="w-full rounded-t bg-accent/80 transition hover:bg-accent"
                      style={{ height: `${Math.max(4, (d.value / maxVal) * 100)}%` }}
                      title={`${d.label}: ${d.value.toLocaleString()}`}
                    />
                    {period === "7d" && (
                      <span className="text-[10px] text-faint">{d.label}</span>
                    )}
                  </div>
                ))}
              </div>
              {period !== "7d" && (
                <p className="mt-3 text-center text-[10px] text-faint">
                  {t("recentDaysCaption", { days: period === "30d" ? 30 : 90 })}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-2">
              <LineChart className="h-4 w-4 text-accent" />
              <CardTitle>{t("modelUsageTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3.5">
                {models.map((m) => (
                  <div key={m.name}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium text-fg-2">{m.name}</span>
                      <span className="font-mono text-muted">{m.pct}%</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-2">
                      <div
                        className={cn("h-full rounded-pill", m.color)}
                        style={{ width: `${m.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 비용 분석 */}
        {costData && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("costAnalysis")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <StatCard label={t("dailyCost")} value={fmtCost(costData.dailyCost)} />
                <StatCard label={t("weeklyCost")} value={fmtCost(costData.weeklyCost)} />
                <StatCard label={t("projectedMonthlyCost")} value={fmtCost(costData.projectedMonthlyCost)} />
              </div>
              {costData.costByModel.length > 0 && (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("col.model")}</Th>
                      <Th className="text-right">{t("col.cost")}</Th>
                      <Th className="text-right">{t("col.share")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {costData.costByModel.map((m) => (
                      <tr key={m.model}>
                        <Td className="font-medium text-fg">{m.model}</Td>
                        <Td className="text-right font-mono text-fg-2">{fmtCost(m.cost)}</Td>
                        <Td className="text-right font-mono text-muted">{m.percentage.toFixed(1)}%</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* 사용자 행동 */}
        {behaviorData && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("userBehavior")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <StatCard
                  label={t("avgSessionLength")}
                  value={t("minutesSuffix", { value: Math.round(behaviorData.avgSessionLength) })}
                />
                <StatCard
                  label={t("avgQueriesPerSession")}
                  value={behaviorData.avgQueriesPerSession.toFixed(1)}
                />
              </div>
              {behaviorData.peakHours.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-fg-2">{t("peakHoursTop3")}</p>
                  <div className="flex flex-wrap gap-2">
                    {behaviorData.peakHours.slice(0, 3).map((h) => (
                      <span
                        key={h.hour}
                        className="rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs text-fg"
                      >
                        {t("peakHourItem", { hour: String(h.hour).padStart(2, "0"), requests: h.requests.toLocaleString() })}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {behaviorData.topQueries.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-medium text-fg-2">{t("topQueriesTop5")}</p>
                  <ol className="space-y-1">
                    {behaviorData.topQueries.slice(0, 5).map((q, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-fg-2">
                        <span className="w-4 shrink-0 font-mono text-faint">{i + 1}.</span>
                        <span className="truncate">{q.query}</span>
                        <span className="ml-auto shrink-0 font-mono text-muted">{q.count}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 에이전트 성능 */}
        {agentsData && agentsData.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>{t("agentPerformance")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("col.agent")}</Th>
                    <Th className="text-right">{t("col.requests")}</Th>
                    <Th className="text-right">{t("col.successRate")}</Th>
                    <Th className="text-right">{t("col.avgResponse")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {agentsData.map((a) => (
                    <tr key={a.agentId}>
                      <Td className="font-medium text-fg">{a.agentName}</Td>
                      <Td className="text-right font-mono text-fg-2">
                        {a.totalRequests.toLocaleString()}
                      </Td>
                      <Td className="text-right font-mono text-fg-2">
                        {a.successRate.toFixed(1)}%
                      </Td>
                      <Td className="text-right font-mono text-fg-2">
                        {Math.round(a.avgResponseTime)}ms
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
