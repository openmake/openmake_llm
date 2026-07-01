"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, Loader2 } from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  StatCard,
  PageHeader,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { toBcp47 } from "@/i18n/config";
import { cn } from "@/lib/utils";

/* ── 타입 (백엔드 /api/usage 응답) ──────────────────────── */
interface PeriodStats {
  totalTokens: number;
  totalRequests: number;
  avgResponseTime: number;
  totalErrors: number;
  modelUsage?: Record<string, number>;
}
interface UsageSummary {
  today: PeriodStats;
  weekly: PeriodStats;
  allTime: PeriodStats;
}
/* 백엔드 /api/usage/daily 는 본인 conversation_messages 집계 ({ date, tokens, messages }) 를 반환.
   목업/기존 필드(totalTokens 등) 와 호환되도록 양쪽 필드 모두 옵셔널로 둠. */
interface DailyRow {
  date: string;
  tokens?: number;
  messages?: number;
  totalRequests?: number;
  totalTokens?: number;
  totalErrors?: number;
  avgResponseTime?: number;
}
/* 실데이터(tokens) ↔ 목업(totalTokens) 통합 접근자 */
const rowTokens = (r: DailyRow) => r.tokens ?? r.totalTokens ?? 0;

/* 모델 프로파일 → 모델색 매핑 */
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

const fmtNum = (n: number | undefined, locale: string) =>
  n != null ? Number(n).toLocaleString(locale) : "-";
const fmtMs = (n?: number) => (n != null && n > 0 ? `${Math.round(n)}ms` : "-");
const fmtCost = (n?: number) =>
  n != null ? `$${n.toFixed(4)}` : "-";

/* ── 시스템 토큰 모니터링 섹션 (관리자 전용) ────────────────── */
interface MonitoringCosts {
  today: {
    totalCost: number;
    byModel: Record<string, number>;
    totalTokens: number;
    totalRequests: number;
  };
  weekly: {
    totalTokens: number;
    totalRequests: number;
    estimatedCost: number;
  };
  priceTable: Record<string, { input: number; output: number }>;
}

interface MonitoringDailyDatasets {
  requests: number[];
  tokens: number[];
  errors: number[];
  avgResponseTime: number[];
}

interface MonitoringDaily {
  labels: string[];
  datasets: MonitoringDailyDatasets;
}

interface MonitoringHourly {
  labels: string[];
  datasets: { requests: number[]; tokens: number[] };
}

function SystemTokenMonitor() {
  const t = useTranslations("usage");
  const locale = toBcp47(useLocale());
  const [costs, setCosts] = useState<MonitoringCosts | null>(null);
  const [daily, setDaily] = useState<MonitoringDaily | null>(null);
  const [hourly, setHourly] = useState<MonitoringHourly | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [costsRes, dailyRes, hourlyRes] = await Promise.all([
          ApiClient.get<{ data: MonitoringCosts }>("/api/monitoring/costs"),
          ApiClient.get<{ data: MonitoringDaily }>("/api/monitoring/usage/daily?days=7"),
          ApiClient.get<{ data: MonitoringHourly }>("/api/monitoring/usage/hourly"),
        ]);
        if (!alive) return;
        setCosts(costsRes?.data ?? null);
        setDaily(dailyRes?.data ?? null);
        setHourly(hourlyRes?.data ?? null);
        setVisible(true);
      } catch {
        // 401/비관리자 → 섹션 숨김
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!visible) return null;

  const maxDailyTokens = Math.max(
    1,
    ...(daily?.datasets.tokens ?? []),
  );
  const maxHourlyTokens = Math.max(
    1,
    ...(hourly?.datasets.tokens ?? []),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("systemMonitorTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* 비용 StatCard 4개 */}
        {costs && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label={t("stat.todayCost")}
              value={fmtCost(costs.today.totalCost)}
            />
            <StatCard
              label={t("stat.todayTokens")}
              value={fmtNum(costs.today.totalTokens, locale)}
            />
            <StatCard
              label={t("stat.weekTokens")}
              value={fmtNum(costs.weekly.totalTokens, locale)}
            />
            <StatCard
              label={t("stat.weekEstCost")}
              value={fmtCost(costs.weekly.estimatedCost)}
            />
          </div>
        )}

        {/* 일별 토큰 바 차트 */}
        {daily && daily.labels.length > 0 && (
          <div>
            <p className="mb-3 text-xs font-medium text-fg-2">{t("dailyTokens7d")}</p>
            <div className="flex h-36 items-end gap-1.5">
              {daily.labels.map((label, i) => {
                const tokens = daily.datasets.tokens[i] ?? 0;
                const pct = Math.max(2, Math.round((tokens / maxDailyTokens) * 100));
                return (
                  <div
                    key={label}
                    className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                    title={t("tokenTooltip", { date: label, count: fmtNum(tokens, locale) })}
                  >
                    <span className="text-[10px] text-faint opacity-0 transition group-hover:opacity-100">
                      {fmtNum(tokens, locale)}
                    </span>
                    <div
                      className="w-full rounded-t bg-accent-soft transition group-hover:bg-accent"
                      style={{ height: `${pct}%` }}
                    />
                    <span className="font-mono text-[9px] text-faint">
                      {label.slice(-5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 시간별 토큰 바 차트 */}
        {hourly && hourly.labels.length > 0 && (
          <div>
            <p className="mb-3 text-xs font-medium text-fg-2">{t("hourlyTokens")}</p>
            <div className="flex h-28 items-end gap-0.5">
              {hourly.labels.map((label, i) => {
                const tokens = hourly.datasets.tokens[i] ?? 0;
                const pct = Math.max(2, Math.round((tokens / maxHourlyTokens) * 100));
                return (
                  <div
                    key={label}
                    className="group flex h-full flex-1 flex-col items-center justify-end gap-0.5"
                    title={t("tokenTooltip", { date: label, count: fmtNum(tokens, locale) })}
                  >
                    <div
                      className="w-full rounded-t bg-success-soft transition group-hover:bg-success"
                      style={{ height: `${pct}%` }}
                    />
                    {i % 4 === 0 && (
                      <span className="font-mono text-[8px] text-faint">
                        {label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 목업 (비로그인/오류 폴백) ──────────────────────────── */
function mockDaily(): DailyRow[] {
  const today = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (13 - i));
    const base = 40 + Math.round(Math.sin(i / 2) * 25 + i * 6);
    return {
      date: d.toISOString().slice(0, 10),
      totalRequests: base,
      totalTokens: base * 1180,
      totalErrors: i % 5 === 0 ? 1 : 0,
      avgResponseTime: 600 + (i % 4) * 90,
    };
  });
}

export default function UsagePage() {
  const t = useTranslations("usage");
  const locale = toBcp47(useLocale());
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string>("-");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usageRes, dailyRes] = await Promise.all([
        ApiClient.get<ApiSuccess<UsageSummary>>("/api/usage"),
        ApiClient.get<ApiSuccess<{ daily: DailyRow[] }>>(
          "/api/usage/daily?days=14",
        ),
      ]);
      setSummary(usageRes?.data ?? null);
      setDaily(dailyRes?.data?.daily ?? []);
      setUsingMock(false);
    } catch {
      // TODO: API 연동 — 비로그인/오류 시 목업
      const md = mockDaily();
      setDaily(md);
      const month = md.reduce(
        (acc, r) => ({
          totalTokens: acc.totalTokens + (r.totalTokens ?? 0),
          totalRequests: acc.totalRequests + (r.totalRequests ?? 0),
          totalErrors: acc.totalErrors + (r.totalErrors ?? 0),
          avgResponseTime: acc.avgResponseTime,
        }),
        { totalTokens: 0, totalRequests: 0, totalErrors: 0, avgResponseTime: 712 },
      );
      setSummary({
        today: { ...month, modelUsage: {} },
        weekly: { ...month, modelUsage: {} },
        allTime: {
          ...month,
          modelUsage: { default: 5200, pro: 2100, fast: 1800, code: 1100 },
        },
      });
      setUsingMock(true);
    } finally {
      setUpdatedAt(new Date().toLocaleTimeString(locale));
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const month = summary?.allTime;
  const modelUsage = month?.modelUsage ?? {};
  const modelTotal = Object.values(modelUsage).reduce((a, b) => a + b, 0);
  const maxDailyTokens = Math.max(1, ...daily.map((d) => rowTokens(d)));

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted">
              {usingMock ? t("mockData") : t("updatedAt", { time: updatedAt })}
            </span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              {t("refresh")}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          {loading && !summary ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          ) : (
            <>
              {/* 상단 StatCard 4개 */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label={t("stat.monthTokens")}
                  value={fmtNum(month?.totalTokens, locale)}
                />
                <StatCard
                  label={t("stat.requests")}
                  value={fmtNum(month?.totalRequests, locale)}
                />
                <StatCard
                  label={t("stat.avgLatency")}
                  value={fmtMs(month?.avgResponseTime)}
                />
                <StatCard
                  label={t("stat.errors")}
                  value={fmtNum(month?.totalErrors, locale)}
                  delta={month?.totalErrors ? t("delta.warning") : t("delta.normal")}
                  deltaTone={month?.totalErrors ? "danger" : "success"}
                />
              </div>

              {/* 일별 사용량 추이 (CSS 바 차트) */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("dailyTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {daily.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">
                      {t("noData")}
                    </p>
                  ) : (
                    <div className="flex h-44 items-end gap-1.5">
                      {daily.map((d) => {
                        const tokens = rowTokens(d);
                        const pct = Math.max(
                          2,
                          Math.round((tokens / maxDailyTokens) * 100),
                        );
                        return (
                          <div
                            key={d.date}
                            className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                            title={t("tokenTooltip", { date: d.date, count: fmtNum(tokens, locale) })}
                          >
                            <span className="text-[10px] text-faint opacity-0 transition group-hover:opacity-100">
                              {fmtNum(tokens, locale)}
                            </span>
                            <div
                              className="w-full rounded-t bg-accent-soft transition group-hover:bg-accent"
                              style={{ height: `${pct}%` }}
                            />
                            <span className="font-mono text-[9px] text-faint">
                              {d.date.slice(5)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* 시스템 토큰 모니터링 */}
              <SystemTokenMonitor />

              {/* 모델별 사용 비중 */}
              <Card>
                <CardHeader>
                  <CardTitle>{t("modelUsageTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="px-0 py-0">
                  {modelTotal === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">
                      {t("noModelData")}
                    </p>
                  ) : (
                    <Table>
                      <thead>
                        <tr>
                          <Th>{t("col.model")}</Th>
                          <Th>{t("col.tokens")}</Th>
                          <Th>{t("col.share")}</Th>
                          <Th className="w-1/3">{t("col.distribution")}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(modelUsage)
                          .sort((a, b) => b[1] - a[1])
                          .map(([model, tokens]) => {
                            const pct = Math.round((tokens / modelTotal) * 100);
                            return (
                              <tr key={model}>
                                <Td className="font-medium text-fg">{model}</Td>
                                <Td>{fmtNum(tokens, locale)}</Td>
                                <Td>{pct}%</Td>
                                <Td>
                                  <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-2">
                                    <div
                                      className={cn(
                                        "h-full rounded-pill",
                                        modelBar(model),
                                      )}
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </Td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
