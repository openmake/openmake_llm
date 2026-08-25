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

/* ── 가상 비용 환산 섹션 (일/월/년) — "상용 API 였다면 얼마" (실제 과금 아님) ── */
interface CostBucket {
  period: string;
  tokens: number;
  costUsd: number;
  costKrw: number;
}
interface CostEstimate {
  rates: { INPUT_USD_PER_1M: number; OUTPUT_USD_PER_1M: number; OUTPUT_RATIO: number; USD_KRW: number };
  day: CostBucket[];
  month: CostBucket[];
  year: CostBucket[];
  total: { tokens: number; costUsd: number; costKrw: number };
  /** 토큰 기록 최초 일자 — 그 이전 사용분은 기록 부재로 미포함 */
  coverage?: { since: string | null };
}
type CostGranularity = "day" | "month" | "year";

function CostEstimateSection() {
  const t = useTranslations("usage");
  const locale = toBcp47(useLocale());
  const [data, setData] = useState<CostEstimate | null>(null);
  const [gran, setGran] = useState<CostGranularity>("day");

  useEffect(() => {
    let alive = true;
    void ApiClient.get<ApiSuccess<CostEstimate>>("/api/usage/cost")
      .then((res) => {
        if (alive) setData(res?.data ?? null);
      })
      .catch(() => {
        /* 비로그인/오류 — 섹션 미표시 */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;

  const fmtKrw = (n: number) => `₩${Math.round(n).toLocaleString(locale)}`;
  const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
  // 오늘/이번 달 카드 — 버킷 키(UTC 기준 date_trunc)와 매칭
  const todayKey = new Date().toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);
  const todayRow = data.day.find((r) => r.period === todayKey);
  const monthRow = data.month.find((r) => r.period === monthKey);
  const rows = [...data[gran]].reverse(); // 최신 우선
  const TABS: Array<{ key: CostGranularity; labelKey: string }> = [
    { key: "day", labelKey: "costTabDay" },
    { key: "month", labelKey: "costTabMonth" },
    { key: "year", labelKey: "costTabYear" },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{t("costTitle")}</CardTitle>
          <p className="mt-0.5 text-xs text-muted">{t("costSubtitle")}</p>
        </div>
        <div className="flex gap-1">
          {TABS.map(({ key, labelKey }) => (
            <button
              key={key}
              type="button"
              onClick={() => setGran(key)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition",
                gran === key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:text-fg",
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <StatCard label={t("costToday")} value={fmtKrw(todayRow?.costKrw ?? 0)} delta={fmtUsd(todayRow?.costUsd ?? 0)} />
          <StatCard label={t("costMonth")} value={fmtKrw(monthRow?.costKrw ?? 0)} delta={fmtUsd(monthRow?.costUsd ?? 0)} />
          <StatCard label={t("costTotal")} value={fmtKrw(data.total.costKrw)} delta={fmtUsd(data.total.costUsd)} />
        </div>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">{t("costNoData")}</p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <thead>
                <tr>
                  <Th>{t("costColPeriod")}</Th>
                  <Th>{t("costColTokens")}</Th>
                  <Th>{t("costColUsd")}</Th>
                  <Th>{t("costColKrw")}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.period}>
                    <Td className="font-mono">{r.period}</Td>
                    <Td>{r.tokens.toLocaleString(locale)}</Td>
                    <Td>{fmtUsd(r.costUsd)}</Td>
                    <Td>{fmtKrw(r.costKrw)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p className="text-[11px] text-faint">
          {data.coverage?.since && (
            <>
              {t("costCoverage", { since: data.coverage.since })}
              <br />
            </>
          )}
          {t("costRateNote", {
            input: data.rates.INPUT_USD_PER_1M,
            output: data.rates.OUTPUT_USD_PER_1M,
            ratio: Math.round(data.rates.OUTPUT_RATIO * 100),
            fx: data.rates.USD_KRW,
          })}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── 내 토큰 쿼터 섹션 (per-user, GET /api/usage/quota) ───────
   LLMClient 가 실제 검사하는 llm/user-quota 버킷을 그대로 읽는다.
   quota=null(비인증·KVStore 장애) 또는 limit<=0(무제한) 이면 섹션 미표시. */
interface QuotaWindow {
  used: number;
  limit: number;
  remaining: number;
  resetAt: number;
}
interface QuotaStatus {
  hourly: QuotaWindow;
  weekly: QuotaWindow;
}

function QuotaBar({
  label,
  win,
  locale,
  resetLabel,
}: {
  label: string;
  win: QuotaWindow;
  locale: string;
  resetLabel: string;
}) {
  const pct = win.limit > 0 ? Math.min(100, Math.round((win.used / win.limit) * 100)) : 0;
  const tone = pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warn" : "bg-accent";
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-fg-2">{label}</span>
        <span className="font-mono text-xs text-muted">
          {fmtNum(win.used, locale)} / {fmtNum(win.limit, locale)} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-pill bg-surface-2">
        <div className={cn("h-full rounded-pill transition-[width]", tone)} style={{ width: `${Math.max(1, pct)}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-faint">{resetLabel}</p>
    </div>
  );
}

function MyQuotaSection() {
  const t = useTranslations("usage");
  const locale = toBcp47(useLocale());
  const [quota, setQuota] = useState<QuotaStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void ApiClient.get<ApiSuccess<{ quota: QuotaStatus | null }>>("/api/usage/quota")
      .then((res) => {
        if (alive) setQuota(res?.data?.quota ?? null);
      })
      .catch(() => {
        /* 비로그인/오류 — 섹션 미표시 */
      });
    return () => {
      alive = false;
    };
  }, []);

  // 두 윈도우 모두 무제한이면 보여줄 것이 없다
  if (!quota || (quota.hourly.limit <= 0 && quota.weekly.limit <= 0)) return null;

  const fmtReset = (ms: number) =>
    t("quotaResetAt", { time: new Date(ms).toLocaleTimeString(locale) });
  const exceeded = quota.hourly.remaining === 0 && quota.hourly.limit > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("quotaTitle")}</CardTitle>
        <p className="mt-0.5 text-xs text-muted">{t("quotaSubtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {quota.hourly.limit > 0 && (
          <QuotaBar
            label={t("quotaHourly")}
            win={quota.hourly}
            locale={locale}
            resetLabel={fmtReset(quota.hourly.resetAt)}
          />
        )}
        {quota.weekly.limit > 0 && (
          <QuotaBar
            label={t("quotaWeekly")}
            win={quota.weekly}
            locale={locale}
            resetLabel={fmtReset(quota.weekly.resetAt)}
          />
        )}
        {exceeded && (
          <p className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert">
            {t("quotaExceeded")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

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

/** 전역 tracker 기준 쿼터(GET /api/monitoring/quota) — per-user 와 다른 관측치라 admin 섹션에만 둔다. */
interface MonitoringQuota {
  hourly: { used: number; limit: number; remaining: number };
  weekly: { used: number; limit: number; remaining: number };
}

function SystemTokenMonitor() {
  const t = useTranslations("usage");
  const locale = toBcp47(useLocale());
  const [costs, setCosts] = useState<MonitoringCosts | null>(null);
  const [daily, setDaily] = useState<MonitoringDaily | null>(null);
  const [hourly, setHourly] = useState<MonitoringHourly | null>(null);
  const [quota, setQuota] = useState<MonitoringQuota | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [costsRes, dailyRes, hourlyRes, quotaRes] = await Promise.all([
          ApiClient.get<{ data: MonitoringCosts }>("/api/monitoring/costs"),
          ApiClient.get<{ data: MonitoringDaily }>("/api/monitoring/usage/daily?days=7"),
          ApiClient.get<{ data: MonitoringHourly }>("/api/monitoring/usage/hourly"),
          ApiClient.get<{ data: MonitoringQuota }>("/api/monitoring/quota"),
        ]);
        if (!alive) return;
        setCosts(costsRes?.data ?? null);
        setDaily(dailyRes?.data ?? null);
        setHourly(hourlyRes?.data ?? null);
        setQuota(quotaRes?.data ?? null);
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

        {/* 전역 쿼터 소진율 (서버 전체 기준 — 개인 쿼터와 별개) */}
        {quota && (quota.hourly.limit > 0 || quota.weekly.limit > 0) && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-fg-2">{t("globalQuotaTitle")}</p>
            {quota.hourly.limit > 0 && (
              <QuotaBar
                label={t("quotaHourly")}
                win={{ ...quota.hourly, resetAt: 0 }}
                locale={locale}
                resetLabel={t("globalQuotaNote")}
              />
            )}
            {quota.weekly.limit > 0 && (
              <QuotaBar
                label={t("quotaWeekly")}
                win={{ ...quota.weekly, resetAt: 0 }}
                locale={locale}
                resetLabel={t("globalQuotaNote")}
              />
            )}
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

export default function UsagePage() {
  const t = useTranslations("usage");
  const locale = toBcp47(useLocale());
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [loading, setLoading] = useState(true);
  // 로드 실패(401·네트워크) 표시 — 그전엔 사인파 목업 14일치가 실렌더됐다
  const [loadError, setLoadError] = useState(false);
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
      setLoadError(false);
    } catch {
      setSummary(null);
      setDaily([]);
      setLoadError(true);
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
              {loadError ? t("loadFailed") : t("updatedAt", { time: updatedAt })}
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

              {/* 내 토큰 쿼터 잔여 (per-user, 실제 enforcement 소스) */}
              <MyQuotaSection />

              {/* 가상 비용 환산 (일/월/년) — 상용 API 였다면 얼마 */}
              <CostEstimateSection />

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
