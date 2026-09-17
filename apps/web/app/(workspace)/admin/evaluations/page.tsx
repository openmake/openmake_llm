"use client";

/**
 * /admin/evaluations — 평가 실행 이력 (F26.1, 146).
 * 백엔드 GET /api/metrics/evaluations(목록)·/:id(실패 케이스). 매트릭스 실행은 matrix_run_id 로 묶어 모델 × variant 표로 보여 준다.
 * 기록은 nightly 평가(OMK_EVAL_RECORD_DB=true)가 남긴다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import { ApiClient } from "@/lib/api-client";

interface EvalRun {
  id: string;
  completed_at: string;
  runner: string;
  mode: "mock" | "real";
  dataset_version: string;
  git_hash: string | null;
  model: string | null;
  variant: string | null;
  matrix_run_id: string | null;
  total_cases: number;
  passed_cases: number;
  pass_rate: number;
  ttft_p50_ms: number | null;
  total_p95_ms: number | null;
  summary?: { failed?: Array<{ id: string; reason: string }> };
}

const RUNNERS = ["", "routing", "response", "tools", "redteam", "matrix"] as const;
const selectCls = "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
function secs(v: number | null): string {
  return v === null ? "—" : `${(v / 1000).toFixed(1)}s`;
}

export default function AdminEvaluationsPage() {
  const t = useTranslations("adminEvaluations");
  const locale = useLocale();
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [runner, setRunner] = useState<string>("");
  const [detail, setDetail] = useState<EvalRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = runner ? `?runner=${encodeURIComponent(runner)}&limit=100` : "?limit=100";
      const r = await ApiClient.get<{ data: { runs: EvalRun[] } }>(`/api/metrics/evaluations${q}`);
      setRuns(r?.data?.runs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [runner, t]);
  useEffect(() => { void load(); }, [load]);

  const openDetail = async (id: string) => {
    if (detail?.id === id) { setDetail(null); return; }
    const r = await ApiClient.get<{ data: { run: EvalRun } }>(`/api/metrics/evaluations/${encodeURIComponent(id)}`).catch(() => null);
    setDetail(r?.data?.run ?? null);
  };

  // 가장 최근 매트릭스 실행 — 모델 × variant 표
  const latestMatrix = useMemo(() => {
    const first = runs.find((r) => r.matrix_run_id);
    if (!first) return null;
    const cells = runs.filter((r) => r.matrix_run_id === first.matrix_run_id);
    const models = [...new Set(cells.map((c) => c.model ?? "—"))];
    const variants = [...new Set(cells.map((c) => c.variant ?? "base"))];
    return { completedAt: first.completed_at, cells, models, variants };
  }, [runs]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex gap-2">
            <select className={selectCls} value={runner} onChange={(e) => setRunner(e.target.value)} aria-label={t("runnerFilter")}>
              {RUNNERS.map((r) => <option key={r} value={r}>{r ? t(`runner.${r}`) : t("allRunners")}</option>)}
            </select>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
            </Button>
          </div>
        }
      />
      <AdminTabs />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {error && <p className="mb-4 text-sm text-danger" role="alert">{error}</p>}

        {latestMatrix && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>{t("matrixTitle", { time: new Date(latestMatrix.completedAt).toLocaleString(locale) })}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("modelVariant")}</Th>
                      {latestMatrix.variants.map((v) => <Th key={v}>{v}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {latestMatrix.models.map((m) => (
                      <tr key={m}>
                        <Td className="font-mono text-xs">{m}</Td>
                        {latestMatrix.variants.map((v) => {
                          const c = latestMatrix.cells.find((x) => (x.model ?? "—") === m && (x.variant ?? "base") === v);
                          return (
                            <Td key={v} className="text-xs">
                              {c ? (
                                <span className="inline-flex flex-col">
                                  <span className="font-mono text-fg">{pct(c.pass_rate)} ({c.passed_cases}/{c.total_cases})</span>
                                  <span className="text-muted">TTFT {secs(c.ttft_p50_ms)} · p95 {secs(c.total_p95_ms)}</span>
                                </span>
                              ) : "—"}
                            </Td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{t("listTitle")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("th.completedAt")}</Th>
                    <Th>{t("th.runner")}</Th>
                    <Th>{t("th.mode")}</Th>
                    <Th>{t("th.model")}</Th>
                    <Th className="text-right">{t("th.passRate")}</Th>
                    <Th className="text-right">{t("th.ttft")}</Th>
                    <Th className="text-right">{t("th.totalP95")}</Th>
                    <Th>{t("th.version")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 && (
                    <tr><Td className="py-8 text-center text-muted" colSpan={8}>{t("empty")}</Td></tr>
                  )}
                  {runs.map((r) => (
                    <EvalRunRow key={r.id} run={r} open={detail?.id === r.id} detail={detail} onToggle={() => void openDetail(r.id)} locale={locale} t={t} />
                  ))}
                </tbody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function EvalRunRow({ run: r, open, detail, onToggle, locale, t }: {
  run: EvalRun; open: boolean; detail: EvalRun | null; onToggle: () => void; locale: string; t: ReturnType<typeof useTranslations>;
}) {
  const failed = open ? detail?.summary?.failed ?? [] : [];
  return (
    <>
      <tr className="cursor-pointer hover:bg-surface-2" onClick={onToggle} aria-expanded={open}>
        <Td className="text-xs">{new Date(r.completed_at).toLocaleString(locale)}</Td>
        <Td className="text-xs">{t(`runner.${r.runner}`)}</Td>
        <Td><Badge tone={r.mode === "real" ? "accent" : "neutral"}>{r.mode}</Badge></Td>
        <Td className="font-mono text-xs">{[r.model, r.variant].filter(Boolean).join(" · ") || "—"}</Td>
        <Td className="text-right font-mono text-xs">{pct(r.pass_rate)} ({r.passed_cases}/{r.total_cases})</Td>
        <Td className="text-right font-mono text-xs">{secs(r.ttft_p50_ms)}</Td>
        <Td className="text-right font-mono text-xs">{secs(r.total_p95_ms)}</Td>
        <Td className="font-mono text-xs text-muted">{r.dataset_version}{r.git_hash ? ` @${r.git_hash}` : ""}</Td>
      </tr>
      {open && (
        <tr>
          <Td colSpan={8} className="bg-surface-2 text-xs">
            {failed.length === 0 ? t("noFailures") : (
              <ul className="space-y-1">
                {failed.map((f) => <li key={f.id}><span className="font-mono text-fg">{f.id}</span> <span className="text-muted">{f.reason}</span></li>)}
              </ul>
            )}
          </Td>
        </tr>
      )}
    </>
  );
}
