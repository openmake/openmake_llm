"use client";

/**
 * /admin/slo — SLO·에러 버짓·burn-rate (F24.8, 145).
 * 백엔드 GET /api/metrics/slo(즉시 계산) · /api/metrics/slo/history(일별 스냅샷). 목표는 시스템 설정 `SLO 목표` 그룹에서 바꾼다.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { RefreshCw, Settings2 } from "lucide-react";
import { PageHeader, PageBody, Card, CardHeader, CardTitle, CardContent, Badge, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import { ApiClient } from "@/lib/api-client";

type SloState = "ok" | "warning" | "critical" | "insufficient";
const SLO_IDS = ["chat_availability", "chat_ttft_p95", "agent_task_success", "eval_pass"] as const;
type SloId = (typeof SLO_IDS)[number];

interface Evaluation {
  sloId: SloId;
  windowHours: number;
  target: number;
  sliValue: number | null;
  sampleCount: number;
  budgetRemaining: number | null;
  burnRateFast: number | null;
  burnRateSlow: number | null;
  state: SloState;
  reason?: string;
  detail?: { thresholdMs?: number; p95Ms?: number | null; completedAt?: string };
}
interface SnapshotRow { computed_at: string; slo_id: SloId; sli_value: number | null; budget_remaining: number | null; state: SloState }

const STATE_TONE: Record<SloState, "success" | "warn" | "danger" | "neutral"> = {
  ok: "success", warning: "warn", critical: "danger", insufficient: "neutral",
};

function pct(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export default function AdminSloPage() {
  const t = useTranslations("adminSlo");
  const locale = useLocale();
  const [evals, setEvals] = useState<Evaluation[]>([]);
  const [history, setHistory] = useState<SnapshotRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [computedAt, setComputedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [cur, hist] = await Promise.all([
        ApiClient.get<{ data: { computedAt: string; evaluations: Evaluation[] } }>("/api/metrics/slo"),
        ApiClient.get<{ data: { rows: SnapshotRow[] } }>("/api/metrics/slo/history?days=30").catch(() => null),
      ]);
      setEvals(cur?.data?.evaluations ?? []);
      setComputedAt(cur?.data?.computedAt ?? null);
      setHistory(hist?.data?.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  // 날짜 → SLO → 스냅샷
  const days = useMemo(() => {
    const byDay = new Map<string, Partial<Record<SloId, SnapshotRow>>>();
    for (const r of history) {
      const day = r.computed_at.slice(0, 10);
      const row = byDay.get(day) ?? {};
      row[r.slo_id] = r;
      byDay.set(day, row);
    }
    return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [history]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={computedAt ? t("computedAt", { time: new Date(computedAt).toLocaleTimeString(locale) }) : t("description")}
        actions={
          <div className="flex gap-2">
            <Link href="/admin/system-settings" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-fg hover:bg-surface-2">
              <Settings2 className="h-3.5 w-3.5" /> {t("openSettings")}
            </Link>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" /> {t("refresh")}
            </Button>
          </div>
        }
      />
      <AdminTabs />
      <PageBody>
        {error && <p className="mb-4 text-sm text-danger" role="alert">{error}</p>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {evals.map((e) => (
            <Card key={e.sloId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span>{t(`slo.${e.sloId}.name`)}</span>
                  <Badge tone={STATE_TONE[e.state]}>{t(`state.${e.state}`)}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted">{t(`slo.${e.sloId}.desc`, { window: Math.round(e.windowHours / 24), threshold: ((e.detail?.thresholdMs ?? 0) / 1000).toFixed(1) })}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-fg">{pct(e.sliValue)}</span>
                  <span className="text-xs text-muted">{t("target", { value: pct(e.target) })}</span>
                </div>
                {e.budgetRemaining !== null && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-muted">
                      <span>{t("budgetRemaining")}</span><span>{pct(e.budgetRemaining, 0)}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(e.budgetRemaining * 100)}>
                      <div
                        className={e.budgetRemaining > 0.5 ? "h-full bg-success" : e.budgetRemaining > 0.1 ? "h-full bg-warn" : "h-full bg-danger"}
                        style={{ width: `${Math.max(0, Math.min(100, e.budgetRemaining * 100))}%` }}
                      />
                    </div>
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {e.burnRateFast !== null && (<><dt className="text-muted">{t("burnFast")}</dt><dd className="font-mono text-fg-2">{e.burnRateFast}×</dd></>)}
                  {e.burnRateSlow !== null && (<><dt className="text-muted">{t("burnSlow")}</dt><dd className="font-mono text-fg-2">{e.burnRateSlow}×</dd></>)}
                  <dt className="text-muted">{t("samples")}</dt><dd className="font-mono text-fg-2">{e.sampleCount.toLocaleString(locale)}</dd>
                  {e.detail?.p95Ms !== undefined && (<><dt className="text-muted">{t("p95")}</dt><dd className="font-mono text-fg-2">{e.detail.p95Ms === null ? "—" : `${(e.detail.p95Ms / 1000).toFixed(1)}s`}</dd></>)}
                  {e.reason && (<><dt className="text-muted">{t("reasonLabel")}</dt><dd className="text-fg-2">{t(`reason.${e.reason}`)}</dd></>)}
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-6">
          <CardHeader><CardTitle>{t("historyTitle")}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("date")}</Th>
                    {SLO_IDS.map((id) => <Th key={id}>{t(`slo.${id}.name`)}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {days.length === 0 && (
                    <tr><Td className="py-8 text-center text-muted" colSpan={SLO_IDS.length + 1}>{t("historyEmpty")}</Td></tr>
                  )}
                  {days.map(([day, row]) => (
                    <tr key={day}>
                      <Td className="font-mono text-xs">{day}</Td>
                      {SLO_IDS.map((id) => {
                        const r = row[id];
                        return (
                          <Td key={id} className="text-xs">
                            {r ? (<span className="inline-flex items-center gap-2"><Badge tone={STATE_TONE[r.state]}>{t(`state.${r.state}`)}</Badge><span className="font-mono">{pct(r.sli_value)}</span></span>) : "—"}
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
      </PageBody>
    </>
  );
}
