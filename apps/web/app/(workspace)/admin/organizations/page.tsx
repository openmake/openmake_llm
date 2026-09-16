"use client";

/**
 * /admin/organizations — 조직 관리 콘솔 (F22 Phase E-1).
 * 조직 CRUD·멤버 역할·조직 정책(129)·변경 이력(130)·운영 구성 내보내기/가져오기.
 * REST: /api/admin/organizations*, /api/admin/config/{export,import}. fetch 직접 호출 금지 — ApiClient 경유.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Plus, Trash2, Users, ShieldCheck, History, Download, Upload, Loader2 } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess, OrgRole } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

interface Org { id: string; name: string; slug: string; monthly_token_budget: string | number | null; monthly_cost_budget_micros?: string | number | null; created_at: string }
interface Member { org_id: string; user_id: string; role: OrgRole; created_at: string }
interface PolicyRow { key: string; value: unknown; updated_by: string | null; updated_at: string }
interface HistoryRow { id: number; key: string; old_value: unknown; new_value: unknown; changed_by: string | null; changed_at: string }
interface AdminUser { id: string; email: string; username?: string }

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";
const selectCls = "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";
const POLICY_KEYS = ["EXTERNAL_MODEL_POLICY", "TOOL_APPROVAL_POLICY_MIN", "MCP_ALLOWED_SERVERS"] as const;
const ROLES: OrgRole[] = ["owner", "admin", "member"];

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** 정책 값 편집기 — 키별 입력 형태(JSON / enum / CSV) 를 서버 스키마와 맞춘다. */
function PolicyEditor({ orgId, policies, onChanged }: { orgId: string; policies: PolicyRow[]; onChanged: () => void }) {
  const t = useTranslations("adminOrganizations");
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const current = (key: string) => policies.find((p) => p.key === key)?.value;

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const key of POLICY_KEYS) {
      const v = current(key);
      if (key === "EXTERNAL_MODEL_POLICY") next[key] = v ? JSON.stringify(v) : "";
      else if (key === "MCP_ALLOWED_SERVERS") next[key] = Array.isArray(v) ? v.join(", ") : "";
      else next[key] = typeof v === "string" ? v : "";
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policies]);

  async function save(key: string) {
    setBusy(key);
    try {
      const raw = drafts[key] ?? "";
      let value: unknown;
      if (key === "EXTERNAL_MODEL_POLICY") value = JSON.parse(raw || "{}");
      else if (key === "MCP_ALLOWED_SERVERS") value = raw.split(",").map((s) => s.trim()).filter(Boolean);
      else value = raw;
      await ApiClient.put(`/api/admin/organizations/${orgId}/policies/${key}`, { value });
      onChanged();
    } catch (e) {
      alert(t("policySaveFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  }
  async function reset(key: string) {
    setBusy(key);
    try { await ApiClient.del(`/api/admin/organizations/${orgId}/policies/${key}`); onChanged(); }
    catch (e) { alert(t("policySaveFailed", { error: e instanceof Error ? e.message : String(e) })); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-3">
      {POLICY_KEYS.map((key) => (
        <div key={key} className="rounded-md border border-line p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-fg">{key}</p>
            {current(key) !== undefined && <Badge tone="accent">{t("policySet")}</Badge>}
          </div>
          <p className="mb-2 text-[11px] text-muted">{t(`policyHelp.${key}`)}</p>
          {key === "TOOL_APPROVAL_POLICY_MIN" ? (
            <select className={selectCls} value={drafts[key] ?? ""} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} aria-label={key}>
              <option value="">{t("policyUnset")}</option>
              <option value="none">none</option>
              <option value="high-risk">high-risk</option>
              <option value="all">all</option>
            </select>
          ) : (
            <input className={inputCls} value={drafts[key] ?? ""} onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })} aria-label={key}
              placeholder={key === "EXTERNAL_MODEL_POLICY" ? '{"deny":["openrouter:*"]}' : "mcp-github, mcp-notion"} />
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy === key || !(drafts[key] ?? "").trim()} onClick={() => void save(key)}>{t("policySave")}</Button>
            {current(key) !== undefined && (
              <Button size="sm" variant="outline" disabled={busy === key} onClick={() => void reset(key)}>{t("policyReset")}</Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function OrgDetail({ org, users, onChanged }: { org: Org; users: AdminUser[]; onChanged: () => void }) {
  const t = useTranslations("adminOrganizations");
  const [members, setMembers] = useState<Member[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [newUser, setNewUser] = useState("");
  const [newRole, setNewRole] = useState<OrgRole>("member");
  const [budget, setBudget] = useState(org.monthly_token_budget === null ? "" : String(org.monthly_token_budget));
  const [costBudget, setCostBudget] = useState(org.monthly_cost_budget_micros == null ? "" : String(Number(org.monthly_cost_budget_micros) / 1_000_000));

  const load = useCallback(async () => {
    const [m, p, h] = await Promise.all([
      ApiClient.get<ApiSuccess<{ members: Member[] }>>(`/api/admin/organizations/${org.id}/members`),
      ApiClient.get<ApiSuccess<{ policies: PolicyRow[] }>>(`/api/admin/organizations/${org.id}/policies`),
      ApiClient.get<ApiSuccess<{ history: HistoryRow[] }>>(`/api/admin/organizations/${org.id}/policies/history?limit=30`),
    ]);
    setMembers(m?.data?.members ?? []);
    setPolicies(p?.data?.policies ?? []);
    setHistory(h?.data?.history ?? []);
  }, [org.id]);
  useEffect(() => { void load(); }, [load]);

  async function saveBudget() {
    const n = budget.trim() === "" ? null : Number(budget);
    const c = costBudget.trim() === "" ? null : Math.round(Number(costBudget) * 1_000_000);
    await ApiClient.patch(`/api/admin/organizations/${org.id}`, { monthlyTokenBudget: n, monthlyCostBudgetMicros: c });
    onChanged();
  }
  async function addMember() {
    if (!newUser) return;
    await ApiClient.put(`/api/admin/organizations/${org.id}/members/${newUser}`, { role: newRole });
    setNewUser(""); await load();
  }
  async function setRole(userId: string, role: OrgRole) {
    await ApiClient.put(`/api/admin/organizations/${org.id}/members/${userId}`, { role }); await load();
  }
  async function removeMember(userId: string) {
    if (!confirm(t("removeMemberConfirm"))) return;
    await ApiClient.del(`/api/admin/organizations/${org.id}/members/${userId}`); await load();
  }
  const label = (id: string) => { const u = users.find((x) => x.id === id); return u ? (u.username ? `${u.username} (${u.email})` : u.email) : id; };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="text-xs text-muted">{t("budget")}</label>
        <input className={`${inputCls} sm:w-48`} type="number" min={1} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t("budgetUnlimited")} />
        <label className="text-xs text-muted">{t("costBudget")}</label>
        <input className={`${inputCls} sm:w-40`} type="number" min={0} step="0.01" value={costBudget} onChange={(e) => setCostBudget(e.target.value)} placeholder={t("budgetUnlimited")} />
        <Button size="sm" onClick={() => void saveBudget()}>{t("save")}</Button>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg"><Users className="h-3.5 w-3.5" /> {t("members")}</p>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row">
          <select className={selectCls} value={newUser} onChange={(e) => setNewUser(e.target.value)} aria-label={t("addMember")}>
            <option value="">{t("selectUser")}</option>
            {users.filter((u) => !members.some((m) => m.user_id === u.id)).map((u) => <option key={u.id} value={u.id}>{label(u.id)}</option>)}
          </select>
          <select className={selectCls} value={newRole} onChange={(e) => setNewRole(e.target.value as OrgRole)} aria-label={t("role")}>
            {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
          </select>
          <Button size="sm" disabled={!newUser} onClick={() => void addMember()}><Plus className="h-3.5 w-3.5" /> {t("addMember")}</Button>
        </div>
        {members.length === 0 ? <p className="text-xs text-muted">{t("noMembers")}</p> : (
          <Table>
            <thead><tr><Th>{t("user")}</Th><Th>{t("role")}</Th><Th></Th></tr></thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.user_id}>
                  <Td>{label(m.user_id)}</Td>
                  <Td>
                    <select className={selectCls} value={m.role} onChange={(e) => void setRole(m.user_id, e.target.value as OrgRole)} aria-label={t("role")}>
                      {ROLES.map((r) => <option key={r} value={r}>{t(`roles.${r}`)}</option>)}
                    </select>
                  </Td>
                  <Td><Button size="sm" variant="ghost" aria-label={t("removeMember")} onClick={() => void removeMember(m.user_id)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg"><ShieldCheck className="h-3.5 w-3.5" /> {t("policies")}</p>
        <PolicyEditor orgId={org.id} policies={policies} onChanged={() => void load()} />
      </div>

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fg"><History className="h-3.5 w-3.5" /> {t("history")}</p>
        {history.length === 0 ? <p className="text-xs text-muted">{t("noHistory")}</p> : (
          <ul className="space-y-1 text-[11px] text-muted">
            {history.map((h) => (
              <li key={h.id} className="rounded bg-bg-1 px-2 py-1">
                <span className="text-fg">{h.key}</span> · {new Date(h.changed_at).toLocaleString()} · {h.changed_by ? label(h.changed_by) : "—"}
                <div className="truncate font-mono">{fmt(h.old_value)} → {fmt(h.new_value)}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ConfigTransfer() {
  const t = useTranslations("adminOrganizations");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pending, setPending] = useState<unknown | null>(null);

  async function exportConfig() {
    setBusy(true);
    try { await ApiClient.download("/api/admin/config/export", `openmake-config-${new Date().toISOString().slice(0, 10)}.json`); }
    catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true); setResult(null); setPending(null);
    try {
      const text = await file.text();
      const config = JSON.parse(text) as unknown;
      const r = await ApiClient.post<ApiSuccess<{ applied: boolean; problems: string[]; summary: Record<string, number> }>>("/api/admin/config/import", { config, apply: false });
      const d = r?.data;
      if (!d) throw new Error("empty");
      if (d.problems.length > 0) setResult(t("importProblems", { count: d.problems.length }) + "\n" + d.problems.join("\n"));
      else { setPending(config); setResult(t("importDryRun", { ...d.summary })); }
    } catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!pending || !confirm(t("importConfirm"))) return;
    setBusy(true);
    try {
      const r = await ApiClient.post<ApiSuccess<{ applied: boolean; summary: Record<string, number> }>>("/api/admin/config/import", { config: pending, apply: true });
      setResult(t("importApplied", { ...(r?.data?.summary ?? {}) })); setPending(null);
    } catch (e) { setResult(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>{t("configTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">{t("configDescription")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportConfig()}><Download className="h-3.5 w-3.5" /> {t("export")}</Button>
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-xs text-fg hover:bg-surface-2">
            <Upload className="h-3.5 w-3.5" /> {t("importPick")}
            <input type="file" accept="application/json" className="hidden" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
          </label>
          {pending !== null && <Button size="sm" disabled={busy} onClick={() => void apply()}>{t("importApply")}</Button>}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        </div>
        {result && <pre className="whitespace-pre-wrap rounded bg-bg-1 p-2 text-[11px] text-muted">{result}</pre>}
      </CardContent>
    </Card>
  );
}

export default function AdminOrganizationsPage() {
  const t = useTranslations("adminOrganizations");
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, u] = await Promise.all([
        ApiClient.get<ApiSuccess<{ organizations: Org[] }>>("/api/admin/organizations"),
        ApiClient.get<{ data?: { users?: AdminUser[] }; users?: AdminUser[] }>("/api/admin/users?limit=500"),
      ]);
      setOrgs(o?.data?.organizations ?? []);
      setUsers(u?.data?.users ?? u?.users ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : t("loadError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    setError(null);
    try {
      await ApiClient.post("/api/admin/organizations", { name, slug });
      setName(""); setSlug(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : t("createFailed")); }
  }
  async function remove(org: Org) {
    if (!confirm(t("deleteConfirm", { name: org.name }))) return;
    await ApiClient.del(`/api/admin/organizations/${org.id}`);
    if (selected === org.id) setSelected(null);
    await load();
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4" /> {t("listTitle")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input className={inputCls} placeholder={t("namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} />
                <input className={inputCls} placeholder={t("slugPlaceholder")} value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
                <Button size="sm" disabled={!name.trim() || !slug.trim()} onClick={() => void create()}><Plus className="h-3.5 w-3.5" /> {t("create")}</Button>
              </div>
              {orgs.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <div className="space-y-2">
                  {orgs.map((org) => (
                    <div key={org.id} className="rounded-md border border-line bg-bg-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(selected === org.id ? null : org.id)}>
                          <p className="truncate text-sm font-medium text-fg">{org.name} <span className="text-xs text-muted">· {org.slug}</span></p>
                          <p className="text-[11px] text-muted">{org.monthly_token_budget === null ? t("budgetUnlimited") : `${t("budget")} ${Number(org.monthly_token_budget).toLocaleString()}`}</p>
                        </button>
                        <Button size="sm" variant="ghost" aria-label={t("delete")} onClick={() => void remove(org)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
                      </div>
                      {selected === org.id && <div className="mt-3 border-t border-line pt-3"><OrgDetail org={org} users={users} onChanged={() => void load()} /></div>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <ConfigTransfer />
        </div>
      </div>
    </>
  );
}
