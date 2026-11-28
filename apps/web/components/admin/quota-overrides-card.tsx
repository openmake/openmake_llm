"use client";

/**
 * 사용자별 쿼터 한도 덮어쓰기 (213, QUOTA_USER_OVERRIDES_ENABLED) — /admin/quota-requests 안 카드.
 * 칸을 비우면 전역 값을 따르고(NULL), 0 은 무제한이다. 플래그가 꺼져 있으면 페이지가 이 카드를 그리지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UserCog, Trash2, Save } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, Button, Table, Th, Td } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

interface OverrideRow {
  user_id: string;
  username: string | null;
  hourly_token_limit: string | number | null;
  weekly_token_limit: string | number | null;
  monthly_cost_budget_micros: string | number | null;
  reason: string | null;
  updated_at: string;
}

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

/** 빈 칸 = null(전역 값), 그 외 0 이상 정수. 잘못된 값은 undefined. */
export function parseLimitInput(v: string): number | null | undefined {
  const s = v.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  return Number(s);
}

function show(v: string | number | null, globalLabel: string, unlimitedLabel: string): string {
  if (v === null) return globalLabel;
  const n = Number(v);
  return n === 0 ? unlimitedLabel : n.toLocaleString();
}

export function QuotaOverridesCard({ onError }: { onError: (msg: string | null) => void }) {
  const t = useTranslations("adminQuotaRequests.overrides");
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [userId, setUserId] = useState("");
  const [hourly, setHourly] = useState("");
  const [weekly, setWeekly] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<ApiSuccess<{ overrides: OverrideRow[] }>>("/api/admin/quota-overrides");
      setRows(r?.data?.overrides ?? []);
    } catch (e) { onError(e instanceof Error ? e.message : t("loadError")); }
  }, [onError, t]);
  useEffect(() => { void load(); }, [load]);

  function edit(r: OverrideRow) {
    setUserId(r.user_id);
    setHourly(r.hourly_token_limit === null ? "" : String(r.hourly_token_limit));
    setWeekly(r.weekly_token_limit === null ? "" : String(r.weekly_token_limit));
    setCost(r.monthly_cost_budget_micros === null ? "" : String(r.monthly_cost_budget_micros));
    setReason(r.reason ?? "");
  }

  async function save() {
    const h = parseLimitInput(hourly), w = parseLimitInput(weekly), c = parseLimitInput(cost);
    if (h === undefined || w === undefined || c === undefined) { onError(t("invalid")); return; }
    setBusy(true); onError(null);
    try {
      await ApiClient.put(`/api/admin/quota-overrides/${encodeURIComponent(userId.trim())}`, {
        hourlyTokenLimit: h, weeklyTokenLimit: w, monthlyCostBudgetMicros: c, reason: reason.trim() || null,
      });
      setUserId(""); setHourly(""); setWeekly(""); setCost(""); setReason("");
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : t("saveFailed")); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); onError(null);
    try { await ApiClient.del(`/api/admin/quota-overrides/${encodeURIComponent(id)}`); await load(); }
    catch (e) { onError(e instanceof Error ? e.message : t("saveFailed")); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><UserCog className="h-4 w-4" /> {t("title")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{t("help")}</p>
        <div className="grid gap-2 sm:grid-cols-6">
          <input className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)} placeholder={t("userId")} aria-label={t("userId")} />
          <input className={inputCls} inputMode="numeric" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder={t("hourly")} aria-label={t("hourly")} />
          <input className={inputCls} inputMode="numeric" value={weekly} onChange={(e) => setWeekly(e.target.value)} placeholder={t("weekly")} aria-label={t("weekly")} />
          <input className={inputCls} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={t("cost")} aria-label={t("cost")} />
          <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("reason")} aria-label={t("reason")} />
          <Button size="sm" disabled={busy || !userId.trim()} onClick={() => void save()}><Save className="h-3.5 w-3.5" /> {t("save")}</Button>
        </div>
        {rows.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>{t("user")}</Th><Th>{t("hourly")}</Th><Th>{t("weekly")}</Th><Th>{t("cost")}</Th><Th>{t("reason")}</Th><Th></Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user_id}>
                    <Td className="text-xs"><span className="font-mono">{r.user_id}</span>{r.username ? ` · ${r.username}` : ""}</Td>
                    <Td>{show(r.hourly_token_limit, t("useGlobal"), t("unlimited"))}</Td>
                    <Td>{show(r.weekly_token_limit, t("useGlobal"), t("unlimited"))}</Td>
                    <Td>{show(r.monthly_cost_budget_micros, t("useGlobal"), t("unlimited"))}</Td>
                    <Td className="text-xs text-muted">{r.reason ?? ""}</Td>
                    <Td>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => edit(r)}>{t("edit")}</Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(r.user_id)} aria-label={t("remove")}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
