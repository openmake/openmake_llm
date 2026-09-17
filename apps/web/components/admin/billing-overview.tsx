"use client";

/**
 * 관리자 비용 원장 요약 (F25 PR-5 계획의 관리자 UI) — 월 명세서(system·조직·사용자)와 에이전트별 비용.
 * 백엔드 `/api/admin/billing/statements`·`/api/admin/billing/by-agent`. 위의 "비용 분석"(가상 환산)과 달리
 * cost_ledger 기준 실제 회계라 단가 미등록 항목은 0 으로 나온다.
 */
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { ApiSuccess } from "@openmake/shared-types";
import { Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { toBcp47 } from "@/i18n/config";

interface StatementLine { kind: string; rateKey: string; unit: string; quantity: number; usdMicros: number }
interface Statement { totalUsdMicros: number; lines: StatementLine[]; materialized: boolean }
interface AgentCost { agentId: string | null; costUsd: number; percentage: number }
type ScopeKind = "system" | "org" | "user";

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const ctrlCls = "h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-fg";

/** 최근 6개월 'YYYY-MM'(UTC) — 사용자 명세서 섹션과 같은 규칙 */
function recentMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export function BillingOverview() {
  const t = useTranslations("adminAnalytics.billing");
  const locale = toBcp47(useLocale());
  const months = recentMonths();
  const [month, setMonth] = useState(months[0]);
  const [scopeKind, setScopeKind] = useState<ScopeKind>("system");
  const [scopeId, setScopeId] = useState("");
  const [appliedScope, setAppliedScope] = useState("system");
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentCost[]>([]);

  useEffect(() => {
    let alive = true;
    setError(null);
    ApiClient.get<ApiSuccess<{ statement: Statement }>>(
      `/api/admin/billing/statements?scope=${encodeURIComponent(appliedScope)}&month=${month}`,
    )
      .then((r) => alive && setStatement(r.data.statement))
      .catch((e: unknown) => { if (alive) { setStatement(null); setError(e instanceof Error ? e.message : t("loadError")); } });
    return () => { alive = false; };
  }, [appliedScope, month, t]);

  useEffect(() => {
    let alive = true;
    ApiClient.get<ApiSuccess<{ costByAgent: AgentCost[] }>>("/api/admin/billing/by-agent?days=30")
      .then((r) => alive && setAgents(r.data.costByAgent))
      .catch(() => alive && setAgents([]));
    return () => { alive = false; };
  }, []);

  const applyScope = () => {
    const id = scopeId.trim();
    setAppliedScope(scopeKind === "system" || !id ? "system" : `${scopeKind}:${id}`);
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-xs text-muted">{t("subtitle")}</p>
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={scopeKind} onChange={(e) => setScopeKind(e.target.value as ScopeKind)} aria-label={t("scope")} className={ctrlCls}>
              <option value="system">{t("scopeSystem")}</option>
              <option value="org">{t("scopeOrg")}</option>
              <option value="user">{t("scopeUser")}</option>
            </select>
            {scopeKind !== "system" && (
              <input value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder={t("scopeIdPlaceholder")}
                aria-label={t("scopeIdPlaceholder")} className={`${ctrlCls} w-40`}
                onKeyDown={(e) => { if (e.key === "Enter") applyScope(); }} />
            )}
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label={t("month")} className={ctrlCls}>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button type="button" onClick={applyScope} className="h-8 rounded-md border border-border px-3 text-xs text-fg hover:bg-surface-2">
              {t("apply")}
            </button>
            <span className="text-xs text-muted">{appliedScope}</span>
          </div>
          {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          {statement && (statement.lines.length === 0 ? (
            <p className="text-xs text-muted">{t("empty")}</p>
          ) : (
            <Table>
              <thead><tr><Th>kind</Th><Th>rate_key</Th><Th>unit</Th><Th className="text-right">{t("qty")}</Th><Th className="text-right">USD</Th></tr></thead>
              <tbody>
                {statement.lines.map((l) => (
                  <tr key={`${l.kind}|${l.rateKey}|${l.unit}`}>
                    <Td>{l.kind}</Td><Td className="font-mono text-xs">{l.rateKey}</Td><Td>{l.unit}</Td>
                    <Td className="text-right font-mono">{l.quantity.toLocaleString(locale)}</Td>
                    <Td className="text-right font-mono">{usd(l.usdMicros)}</Td>
                  </tr>
                ))}
                <tr>
                  <Td className="font-medium">{t("total")} · {statement.materialized ? t("final") : t("live")}</Td>
                  <Td /><Td /><Td />
                  <Td className="text-right font-mono font-medium">{usd(statement.totalUsdMicros)}</Td>
                </tr>
              </tbody>
            </Table>
          ))}
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-fg">{t("byAgentTitle")}</h3>
          {agents.length === 0 ? (
            <p className="text-xs text-muted">{t("byAgentEmpty")}</p>
          ) : (
            <Table>
              <thead><tr><Th>{t("agent")}</Th><Th className="text-right">USD</Th><Th className="text-right">%</Th></tr></thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.agentId ?? "none"}>
                    <Td className="font-mono text-xs">{a.agentId ?? t("noAgent")}</Td>
                    <Td className="text-right font-mono">${a.costUsd.toFixed(4)}</Td>
                    <Td className="text-right font-mono text-muted">{a.percentage}%</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
