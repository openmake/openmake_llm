"use client";

/**
 * 조직 확장 배포 모드·그룹 패널 (마켓플레이스 계획 v3.7 §8-1).
 * 조직 공개 확장마다 배포 기본값(default_off·default_on·required)과 그룹별 덮어쓰기를 고르고, 조직 내 그룹·멤버를 관리한다.
 * 해석(그룹 덮어쓰기 > 기본값, 여러 그룹이면 가장 강한 값)은 서버(config/extension-org-deployment)가 한다.
 * REST: /api/organizations/:id/{extension-deployments,groups}* — 플래그 EXTENSION_ORG_DEPLOYMENT_MODES_ENABLED 가 꺼져 있으면
 * 404 라 이 패널은 아무것도 그리지 않는다. 조직 owner/admin·시스템 admin 만 쓸 수 있다(그 외 403 → 그리지 않음).
 * /admin/organizations(시스템 관리자)와 설정 → 일반의 조직 카드(조직 관리자)가 함께 쓴다. ApiClient 만 쓴다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Plus, Trash2, X } from "lucide-react";
import { Badge, Button, Table, Th, Td } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient, ApiError } from "@/lib/api-client";

type Mode = "default_off" | "default_on" | "required";
const MODES: Mode[] = ["default_off", "default_on", "required"];

interface Item {
  extension_id: string;
  name: string;
  version: string;
  description: string | null;
  mode: Mode;
  group_modes: Record<string, Mode>;
  installed_count: number;
}
interface Group { id: string; name: string; member_ids: string[] }
interface MemberOption { userId: string; label: string }

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";
const selectCls = "h-8 rounded-md border border-border bg-surface-2 px-2 text-xs text-fg focus:border-accent focus:outline-none";

/** `members` 를 주면 그 표시 이름을 쓰고(관리자 콘솔 — 이메일 포함), 없으면 서버가 준 조직 멤버(username)를 쓴다 */
export function OrgExtensionDeploymentsPanel({ orgId, members: memberLabels }: { orgId: string; members?: MemberOption[] }) {
  const t = useTranslations("orgExtensionDeployments");
  const [items, setItems] = useState<Item[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [orgMembers, setOrgMembers] = useState<MemberOption[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [newGroup, setNewGroup] = useState("");
  const [error, setError] = useState<string | null>(null);

  const base = `/api/organizations/${encodeURIComponent(orgId)}`;
  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<ApiSuccess<{ items: Item[]; groups: Group[]; members?: Array<{ user_id: string; username: string }> }>>(`${base}/extension-deployments`);
      setItems(r?.data?.items ?? []);
      setGroups(r?.data?.groups ?? []);
      setOrgMembers((r?.data?.members ?? []).map((m) => ({ userId: m.user_id, label: m.username })));
      setAvailable(true);
    } catch (e) {
      // 꺼짐(404)·권한 없음(403) — 패널을 그리지 않는다
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setAvailable(false);
      else { setAvailable(true); setError(e instanceof Error ? e.message : String(e)); }
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (e) { setError(t("saveFailed", { error: e instanceof Error ? e.message : String(e) })); }
    finally { setBusy(false); }
  }

  if (!available) return null;

  const members = memberLabels && memberLabels.length > 0 ? memberLabels : orgMembers;
  const label = (userId: string) => members.find((m) => m.userId === userId)?.label ?? userId;
  const modeLabel = (m: Mode) => t(`modes.${m}`);

  return (
    <div className="space-y-4" data-testid="org-extension-deployments">
      <p className="flex items-center gap-1.5 text-xs font-medium text-fg"><Layers className="h-3.5 w-3.5" /> {t("title")}</p>
      <p className="text-[11px] text-muted">{t("description")}</p>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}

      <div className="rounded-md border border-line p-3">
        <p className="mb-2 text-xs font-medium text-fg">{t("groupsTitle")}</p>
        <div className="mb-2 flex flex-col gap-2 sm:flex-row">
          <input className={inputCls} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder={t("groupNamePlaceholder")} aria-label={t("groupNamePlaceholder")} maxLength={100} />
          <Button size="sm" disabled={busy || !newGroup.trim()} onClick={() => void run(async () => { await ApiClient.post(`${base}/groups`, { name: newGroup.trim() }); setNewGroup(""); })}>
            <Plus className="h-3.5 w-3.5" /> {t("addGroup")}
          </Button>
        </div>
        {groups.length === 0 ? <p className="text-xs text-muted">{t("noGroups")}</p> : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id} className="rounded bg-bg-1 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-fg">{g.name} <span className="text-muted">· {t("memberCount", { count: g.member_ids.length })}</span></p>
                  <Button size="sm" variant="ghost" aria-label={t("deleteGroup")} disabled={busy}
                    onClick={() => { if (confirm(t("deleteGroupConfirm", { name: g.name }))) void run(() => ApiClient.del(`${base}/groups/${g.id}`)); }}>
                    <Trash2 className="h-3.5 w-3.5 text-danger" />
                  </Button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {g.member_ids.map((uid) => (
                    <span key={uid} className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-[11px] text-fg">
                      {label(uid)}
                      <button type="button" aria-label={t("removeGroupMember")} disabled={busy}
                        onClick={() => void run(() => ApiClient.del(`${base}/groups/${g.id}/members/${encodeURIComponent(uid)}`))}>
                        <X className="h-3 w-3 text-muted" />
                      </button>
                    </span>
                  ))}
                  <select className={selectCls} value="" disabled={busy} aria-label={t("addGroupMember")}
                    onChange={(e) => { const uid = e.target.value; if (uid) void run(() => ApiClient.put(`${base}/groups/${g.id}/members/${encodeURIComponent(uid)}`, {})); }}>
                    <option value="">{t("addGroupMember")}</option>
                    {members.filter((m) => !g.member_ids.includes(m.userId)).map((m) => <option key={m.userId} value={m.userId}>{m.label}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-medium text-fg">{t("itemsTitle")}</p>
        {items.length === 0 ? <p className="text-xs text-muted">{t("noItems")}</p> : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>{t("item")}</Th>
                  <Th>{t("defaultMode")}</Th>
                  {groups.map((g) => <Th key={g.id}>{g.name}</Th>)}
                  <Th>{t("installed")}</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.extension_id}>
                    <Td>
                      <span className="text-sm text-fg">{it.name}</span> <span className="font-mono text-[11px] text-muted">v{it.version}</span>
                      {it.mode !== "default_off" && <Badge tone="accent">{modeLabel(it.mode)}</Badge>}
                    </Td>
                    <Td>
                      <select className={selectCls} value={it.mode} disabled={busy} aria-label={t("defaultModeAria", { name: it.name })}
                        onChange={(e) => void run(() => ApiClient.put(`${base}/extension-deployments/${it.extension_id}`, { mode: e.target.value }))}>
                        {MODES.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
                      </select>
                    </Td>
                    {groups.map((g) => (
                      <Td key={g.id}>
                        <select className={selectCls} value={it.group_modes[g.id] ?? ""} disabled={busy} aria-label={t("groupModeAria", { name: it.name, group: g.name })}
                          onChange={(e) => void run(() => ApiClient.put(`${base}/extension-deployments/${it.extension_id}/groups/${g.id}`, { mode: e.target.value || null }))}>
                          <option value="">{t("inherit")}</option>
                          {MODES.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
                        </select>
                      </Td>
                    ))}
                    <Td><span className="text-xs text-muted">{it.installed_count}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">{t("ruleHint")}</p>
      </div>
    </div>
  );
}
