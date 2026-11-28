"use client";

/**
 * /admin/quota-requests — 쿼터 초과 승인함 (F25 PR-3b, 135). 승인 시 quota_grants(kind approval) 가 생겨 해당 버킷의 유효 한도가 늘어난다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Gauge, Check, X, Plus } from "lucide-react";
import { PageHeader, PageBody, Card, CardHeader, CardTitle, CardContent, Badge, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { QuotaOverridesCard } from "@/components/admin/quota-overrides-card";

interface QuotaFeatures { userOverrides: boolean; orgGrants: boolean; orgBucket: boolean; storageDailySnapshot: boolean }

interface Req { id: string; user_id: string; window: string; bucket: string; requested_amount: string | number; reason: string | null; status: string; auto_created: boolean; granted_amount: string | number | null; created_at: string; expires_at: string }
const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";
const selectCls = "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

export default function AdminQuotaRequestsPage() {
  const t = useTranslations("adminQuotaRequests");
  const [status, setStatus] = useState("pending");
  const [rows, setRows] = useState<Req[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gUser, setGUser] = useState(""); const [gWindow, setGWindow] = useState("weekly"); const [gAmount, setGAmount] = useState("");
  // F25 잔여(opt-in) — 켜진 기능만 그린다. 조회 실패는 전부 꺼짐으로(종전 화면)
  const [features, setFeatures] = useState<QuotaFeatures | null>(null);
  const [gSubject, setGSubject] = useState<"user" | "org">("user");
  const [gDimension, setGDimension] = useState<"tokens" | "cost_micros">("tokens");
  useEffect(() => {
    ApiClient.get<ApiSuccess<QuotaFeatures>>("/api/admin/quota-features")
      .then((r) => setFeatures(r?.data ?? null))
      .catch(() => setFeatures(null));
  }, []);
  const extendedGrant = features?.orgGrants === true && (gSubject !== "user" || gDimension !== "tokens");

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<ApiSuccess<{ requests: Req[] }>>(`/api/admin/quota-overage?status=${status}`);
      setRows(r?.data?.requests ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : t("loadError")); }
  }, [status, t]);
  useEffect(() => { void load(); }, [load]);

  async function decide(r: Req, action: "approve" | "reject") {
    setBusy(r.id);
    try { await ApiClient.post(`/api/admin/quota-overage/${r.id}/${action}`, {}); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : t("actionFailed")); }
    finally { setBusy(null); }
  }
  async function grant() {
    setError(null);
    try {
      const id = gUser.trim();
      await ApiClient.post("/api/admin/quota-grants", extendedGrant
        ? { ...(gSubject === "org" ? { orgId: id } : { userId: id }), subjectType: gSubject, dimension: gDimension, window: "monthly", amount: Number(gAmount) }
        : { userId: id, window: gWindow, amount: Number(gAmount) });
      setGUser(""); setGAmount("");
      alert(t("grantDone"));
    } catch (e) { setError(e instanceof Error ? e.message : t("actionFailed")); }
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <PageBody>
        <div className="space-y-6">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><Gauge className="h-4 w-4" /> {t("listTitle")}</span>
                <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t("status")}>
                  {["pending", "approved", "rejected", "all"].map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
                </select>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <Table>
                  <thead><tr><Th>{t("user")}</Th><Th>{t("window")}</Th><Th>{t("amount")}</Th><Th>{t("reason")}</Th><Th>{t("status")}</Th><Th></Th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <Td className="font-mono text-xs">{r.user_id}</Td>
                        <Td>{r.window} · {r.bucket}</Td>
                        <Td>{Number(r.requested_amount).toLocaleString()}{r.granted_amount !== null ? ` → ${Number(r.granted_amount).toLocaleString()}` : ""}</Td>
                        <Td className="text-xs text-muted">{r.auto_created ? t("auto") : r.reason ?? ""}</Td>
                        <Td><Badge tone={r.status === "approved" ? "accent" : "neutral"}>{t(`statuses.${r.status}`)}</Badge></Td>
                        <Td>
                          {r.status === "pending" && (
                            <div className="flex gap-1">
                              <Button size="sm" disabled={busy === r.id} onClick={() => void decide(r, "approve")}><Check className="h-3.5 w-3.5" /> {t("approve")}</Button>
                              <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void decide(r, "reject")}><X className="h-3.5 w-3.5" /> {t("reject")}</Button>
                            </div>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("manualTitle")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted">{t("manualHelp")}</p>
              {features?.orgGrants && <p className="text-xs text-muted">{t("extendedGrantHelp")}</p>}
              <div className={`grid gap-2 ${features?.orgGrants ? "sm:grid-cols-6" : "sm:grid-cols-4"}`}>
                {features?.orgGrants && (
                  <>
                    <select className={selectCls} value={gSubject} onChange={(e) => setGSubject(e.target.value as "user" | "org")} aria-label={t("subject")}>
                      <option value="user">{t("subjects.user")}</option>
                      <option value="org">{t("subjects.org")}</option>
                    </select>
                    <select className={selectCls} value={gDimension} onChange={(e) => setGDimension(e.target.value as "tokens" | "cost_micros")} aria-label={t("dimension")}>
                      <option value="tokens">{t("dimensions.tokens")}</option>
                      <option value="cost_micros">{t("dimensions.cost_micros")}</option>
                    </select>
                  </>
                )}
                <input className={inputCls} value={gUser} onChange={(e) => setGUser(e.target.value)} placeholder={gSubject === "org" && features?.orgGrants ? t("orgIdPlaceholder") : t("userIdPlaceholder")} aria-label={t("user")} />
                <select className={selectCls} value={extendedGrant ? "monthly" : gWindow} disabled={extendedGrant} onChange={(e) => setGWindow(e.target.value)} aria-label={t("window")}>
                  {["hourly", "weekly", "monthly"].map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
                <input className={inputCls} type="number" min={1} value={gAmount} onChange={(e) => setGAmount(e.target.value)} placeholder={t("amount")} aria-label={t("amount")} />
                <Button size="sm" disabled={!gUser.trim() || !gAmount} onClick={() => void grant()}><Plus className="h-3.5 w-3.5" /> {t("grant")}</Button>
              </div>
            </CardContent>
          </Card>
          {features?.userOverrides && <QuotaOverridesCard onError={setError} />}
        </div>
      </PageBody>
    </>
  );
}
