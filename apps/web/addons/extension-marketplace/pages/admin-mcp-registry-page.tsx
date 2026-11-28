"use client";

/**
 * 관리자 MCP Registry 화면(M7) — 공식 레지스트리 사본의 동기화 상태·큐레이션(승인·숨김·보류)·MCP 카탈로그로 올리기.
 * 백엔드 `/api/extension-marketplace/registry/admin/*`. 동기화는 `EXT_MARKET_MCP_REGISTRY_SYNC`(기본 OFF)를 켜야 돈다 —
 * 꺼져 있어도 이미 받은 사본은 그대로 보인다. "게시자 확인" 은 레지스트리가 네임스페이스 소유를 확인했다는 뜻뿐이다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Loader2, RefreshCw, Search } from "lucide-react";
import { PageHeader, PageBody, Card, CardContent, Badge, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import {
  CURATION_TONE,
  type Curation,
  type RegistryAdminEntry,
  type RegistryStatus,
  installSummary,
  quickActionsEnabled,
  REGISTRY_SEARCH_DEBOUNCE_MS,
} from "./registry-view";

const BASE = "/api/extension-marketplace/registry/admin";
const PAGE_SIZE = 50;
/** 서버 운영 설정 키(add-on contributions) — 번역 문구에 이름을 넣지 않고 인자로 넘긴다 */
const SYNC_FLAG = "EXT_MARKET_MCP_REGISTRY_SYNC";
const FILTERS: readonly (Curation | "all")[] = ["all", "pending", "approved", "hidden"];
const inputCls = "h-9 w-64 rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";

function StatusCard({ status, onSync, syncing }: { status: RegistryStatus | null; onSync: () => void; syncing: boolean }) {
  const t = useTranslations("marketRegistry");
  if (!status) return null;
  const s = status.state;
  const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : t("never"));
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-4 text-sm">
        <Badge tone={status.syncEnabled ? "success" : "neutral"}>{status.syncEnabled ? t("syncOn") : t("syncOff")}</Badge>
        <span className="text-fg-2">{t("lastSuccess")}: {fmt(s.lastSuccessAt)}</span>
        {s.cursor && <span className="text-fg-2">{t("inProgress")}</span>}
        {status.backingOff && s.backoffUntil && (
          <span className="text-warn">{t("backoffUntil", { at: fmt(s.backoffUntil) })}</span>
        )}
        {s.lastError && <span className="text-danger">{t("lastError")}: {s.lastError}</span>}
        <span className="text-muted">
          {t("counts", { pending: status.counts.pending, approved: status.counts.approved, hidden: status.counts.hidden, tombstoned: status.counts.tombstoned })}
        </span>
        <div className="ml-auto">
          <Button size="sm" variant="outline" onClick={onSync} disabled={!status.syncEnabled || syncing} title={status.syncEnabled ? undefined : t("syncOffHint", { key: SYNC_FLAG })}>
            {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("syncNow")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EntryRow({ entry, onChanged, quick }: { entry: RegistryAdminEntry; onChanged: (msg: string) => void; quick: boolean }) {
  const t = useTranslations("marketRegistry");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function act(fn: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      onChanged(await fn());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("actionError"));
    } finally {
      setBusy(false);
    }
  }
  const curate = (curation: Curation) => act(async () => {
    await ApiClient.put(`${BASE}/entries/curation`, { serverName: entry.serverName, curation });
    return t("curated");
  });
  const promote = () => act(async () => {
    const r = await ApiClient.post<ApiEnvelope<{ catalogId: string; status: string }>>(`${BASE}/entries/promote`, { serverName: entry.serverName });
    return t(r.data.status === "exists" ? "promoteExists" : "promoted", { id: r.data.catalogId });
  });
  // 승인 + 올리기 한 번에(빠른 작업) — 올릴 수 없는 항목은 서버가 승인하지 않고 거절한다
  const approvePromote = () => act(async () => {
    const r = await ApiClient.post<ApiEnvelope<{ catalogId: string; status: string }>>(`${BASE}/entries/approve-promote`, { serverName: entry.serverName });
    return t(r.data.status === "exists" ? "promoteExists" : "approvePromoted", { id: r.data.catalogId });
  });
  const tomb = Boolean(entry.tombstonedAt);

  return (
    <tr>
      <Td>
        <div className="font-medium text-fg">{entry.title ?? entry.serverName}</div>
        <div className="font-mono text-xs text-muted">{entry.serverName}@{entry.version}</div>
        {entry.description && <div className="mt-1 line-clamp-2 max-w-md text-xs text-fg-2">{entry.description}</div>}
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-success" title={t("publisherVerifiedHint")}>
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
          {t("publisherVerified")}
        </div>
      </Td>
      <Td className="text-xs text-fg-2">{installSummary(entry) ?? t("noInstall")}</Td>
      <Td>
        <div className="flex flex-col items-start gap-1">
          <Badge tone={CURATION_TONE[entry.curation]}>{t(`curation.${entry.curation}`)}</Badge>
          {entry.status !== "active" && <Badge tone="warn">{t(`registryStatus.${entry.status}`)}</Badge>}
          {tomb && <Badge tone="danger">{t("tombstoned")}</Badge>}
          {entry.promotedCatalogId && <span className="font-mono text-xs text-muted">{entry.promotedCatalogId}</span>}
        </div>
      </Td>
      <Td>
        <div className="flex flex-wrap gap-1">
          {quick && entry.curation !== "approved" && !tomb && !entry.promotedCatalogId && (
            <Button size="sm" disabled={busy} onClick={approvePromote}>{t("approvePromote")}</Button>
          )}
          {entry.curation !== "approved" && !tomb && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => curate("approved")}>{t("approve")}</Button>
          )}
          {entry.curation !== "hidden" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => curate("hidden")}>{t("hide")}</Button>
          )}
          {entry.curation !== "pending" && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => curate("pending")}>{t("reset")}</Button>
          )}
          {entry.curation === "approved" && !tomb && (
            <Button size="sm" disabled={busy} onClick={promote}>{t("promote")}</Button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </Td>
    </tr>
  );
}

export function AdminMcpRegistryPage() {
  const t = useTranslations("marketRegistry");
  const [status, setStatus] = useState<RegistryStatus | null>(null);
  const [entries, setEntries] = useState<RegistryAdminEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<Curation | "all">("pending");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [offset, setOffset] = useState(0);
  const [showTomb, setShowTomb] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ curation: filter, limit: String(PAGE_SIZE), offset: String(offset), includeTombstoned: String(showTomb) });
      if (search.trim()) q.set("search", search.trim());
      const [s, l] = await Promise.all([
        ApiClient.get<ApiEnvelope<RegistryStatus>>(`${BASE}/status`),
        ApiClient.get<ApiEnvelope<{ total: number; entries: RegistryAdminEntry[] }>>(`${BASE}/entries?${q.toString()}`),
      ]);
      setStatus(s?.data ?? null);
      setEntries(l?.data?.entries ?? []);
      setTotal(l?.data?.total ?? 0);
    } catch {
      /* 실패 시 직전 목록 유지 */
    } finally {
      setLoading(false);
    }
  }, [filter, offset, search, showTomb]);

  useEffect(() => {
    void load();
  }, [load]);

  const quick = quickActionsEnabled(status);
  // 빠른 작업이 켜져 있으면 입력을 멈춘 뒤 자동 검색(Enter·검색 버튼은 언제나 즉시)
  useEffect(() => {
    if (!quick || draft === search) return;
    const id = setTimeout(() => { setSearch(draft); setOffset(0); }, REGISTRY_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [quick, draft, search]);
  const runSearch = () => { setSearch(draft); setOffset(0); };

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await ApiClient.post<ApiEnvelope<{ outcome: { status: string } }>>(`${BASE}/sync`, {});
      setNotice(t("syncResult", { status: r.data.outcome.status }));
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : t("actionError"));
    } finally {
      setSyncing(false);
      void load();
    }
  }

  return (
    <>
      <PageHeader title={t("pageTitle")} description={t("pageDescription")} />
      <AdminTabs />
      <PageBody>
        <div className="space-y-4">
          <StatusCard status={status} onSync={syncNow} syncing={syncing} />
          {notice && <p role="status" className="text-sm text-fg-2">{notice}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => { setFilter(f); setOffset(0); }}>
                {f === "all" ? t("filterAll") : t(`curation.${f}`)}
              </Button>
            ))}
            <input
              className={inputCls}
              value={draft}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            />
            {quick && (
              <Button size="sm" variant="outline" onClick={runSearch}>
                <Search className="h-3.5 w-3.5" aria-hidden />
                {t("search")}
              </Button>
            )}
            {quick && search.trim() && !loading && (
              <span className="text-xs text-muted">{t("searchResult", { total })}</span>
            )}
            <label className="flex items-center gap-1 text-xs text-fg-2">
              <input type="checkbox" checked={showTomb} onChange={(e) => { setShowTomb(e.target.checked); setOffset(0); }} />
              {t("showTombstoned")}
            </label>
          </div>
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <thead>
                  <tr>
                    <Th>{t("colServer")}</Th>
                    <Th>{t("colInstall")}</Th>
                    <Th>{t("colState")}</Th>
                    <Th>{t("colActions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><Td colSpan={4}><div className="py-12 text-center text-muted">{t("loading")}</div></Td></tr>
                  ) : entries.length === 0 ? (
                    <tr><Td colSpan={4}><div className="py-12 text-center text-muted">{t("empty")}</div></Td></tr>
                  ) : (
                    entries.map((e) => <EntryRow key={e.serverName} entry={e} quick={quick} onChanged={(msg) => { setNotice(msg); void load(); }} />)
                  )}
                </tbody>
              </Table>
            </CardContent>
          </Card>
          <div className="flex items-center justify-between text-xs text-muted">
            <span>{t("pageInfo", { from: total === 0 ? 0 : offset + 1, to: Math.min(offset + PAGE_SIZE, total), total })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>{t("prev")}</Button>
              <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>{t("next")}</Button>
            </div>
          </div>
        </div>
      </PageBody>
    </>
  );
}
