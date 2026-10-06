"use client";

/**
 * /admin/agent-task-metrics — 에이전트 작업 지표(Companion P5 측정 장치, 2026-10-06).
 * 실행 방식별 성공률·소요 시간·토큰·사용자 개입·실패 사유를 표로 본다. 집계 정의는 API 저장소
 * (agent-task-outcome-metrics-repository) 주석과 같다. 차트 없이 표만.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BarChart3, RefreshCw, TriangleAlert } from "lucide-react";
import { PageHeader, PageBody, Card, CardHeader, CardTitle, CardContent, Button, Table, Th, Td, NativeSelect } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { AgentTaskMetricsGroup, AgentTaskMetricsResponse, ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

type Fmt = "int" | "pct" | "ms" | "dec";
/** 표의 행 — 문구 키와 값 꺼내는 칼럼, 표시 형식. */
const ROWS: Array<{ key: keyof AgentTaskMetricsGroup; fmt: Fmt }> = [
  { key: "total", fmt: "int" },
  { key: "completed", fmt: "int" },
  { key: "failed", fmt: "int" },
  { key: "cancelled", fmt: "int" },
  { key: "inProgress", fmt: "int" },
  { key: "successRate", fmt: "pct" },
  { key: "durationP50Ms", fmt: "ms" },
  { key: "durationP95Ms", fmt: "ms" },
  { key: "tokenTasks", fmt: "int" },
  { key: "tokensAvg", fmt: "int" },
  { key: "tokensSum", fmt: "int" },
  { key: "cachedPromptTokensSum", fmt: "int" },
  { key: "approvalRequests", fmt: "int" },
  { key: "questions", fmt: "int" },
  { key: "deviceWaits", fmt: "int" },
  { key: "browserTakeovers", fmt: "int" },
  { key: "interventionsPerTask", fmt: "dec" },
];
/** 행 키 → 문구 키(칼럼 이름과 다른 것만). */
const LABEL_KEY: Partial<Record<keyof AgentTaskMetricsGroup, string>> = { durationP50Ms: "durationP50", durationP95Ms: "durationP95" };
/** 실행 방식 값 → 문구 키. 모르는 값은 그대로 보인다. */
const EXECUTOR_LABEL_KEY: Record<string, string> = { local: "executorLocal", sandbox: "executorSandbox" };
const DEFAULT_DAYS = 7;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const PERCENT = 100;
const DECIMALS = 2;

export default function AdminAgentTaskMetricsPage() {
  const t = useTranslations("adminAgentTaskMetrics");
  const locale = useLocale();
  const [days, setDays] = useState(DEFAULT_DAYS);
  const [data, setData] = useState<AgentTaskMetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<AgentTaskMetricsResponse>>(`/api/agent-tasks/metrics?days=${days}`);
      setData(r?.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : t("loadError")); }
  }, [days, t]);
  useEffect(() => { void load(); }, [load]);

  const num = (v: number, digits = 0) => v.toLocaleString(locale, { maximumFractionDigits: digits });
  function format(v: AgentTaskMetricsGroup[keyof AgentTaskMetricsGroup], fmt: Fmt): string {
    if (v === null || typeof v !== "number") return "—";
    if (fmt === "pct") return `${num(v * PERCENT, 1)}%`;
    if (fmt === "dec") return num(v, DECIMALS);
    if (fmt === "ms") {
      const s = v / MS_PER_SECOND;
      return s < SECONDS_PER_MINUTE ? `${num(s, 1)}s` : `${num(s / SECONDS_PER_MINUTE, 1)}m`;
    }
    return num(v);
  }

  const columns = data ? [data.overall, ...data.byExecutor] : [];
  const colLabel = (g: AgentTaskMetricsGroup) =>
    g.executor === null ? t("overall") : EXECUTOR_LABEL_KEY[g.executor] ? t(EXECUTOR_LABEL_KEY[g.executor]) : g.executor;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <PageBody>
        <div className="space-y-6">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> {t("summaryTitle")}
                <span className="ml-auto flex items-center gap-2 text-xs font-normal">
                  <label htmlFor="metrics-days">{t("period")}</label>
                  <NativeSelect id="metrics-days" selectSize="sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                    {(data?.dayOptions ?? [DEFAULT_DAYS]).map((d) => <option key={d} value={d}>{t("days", { days: d })}</option>)}
                  </NativeSelect>
                  <Button size="sm" variant="ghost" aria-label={t("refresh")} onClick={() => void load()}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data && data.overall.total === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("metric")}</Th>
                      {columns.map((g) => <Th key={g.executor ?? "_all"} className="text-right">{colLabel(g)}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => (
                      <tr key={row.key}>
                        <Td className="text-xs">{t(LABEL_KEY[row.key] ?? row.key)}</Td>
                        {columns.map((g) => (
                          <Td key={g.executor ?? "_all"} className="text-right font-mono text-xs">{format(g[row.key], row.fmt)}</Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              <p className="mt-3 text-[11px] text-muted">{t("notes")}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TriangleAlert className="h-4 w-4" /> {t("failuresTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {!data || data.topFailures.length === 0 ? <p className="text-xs text-muted">{t("noFailures")}</p> : (
                <Table>
                  <thead><tr><Th>{t("failureClass")}</Th><Th className="text-right">{t("count")}</Th></tr></thead>
                  <tbody>
                    {data.topFailures.map((f) => (
                      <tr key={f.failureClass}>
                        <Td className="font-mono text-xs">{f.failureClass}</Td>
                        <Td className="text-right font-mono text-xs">{num(f.count)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
