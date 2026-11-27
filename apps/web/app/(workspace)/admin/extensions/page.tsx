"use client";

/**
 * /admin/extensions — 확장 현황(마켓플레이스 남은 개발계획 v3.7 M3).
 *
 * 사용자별 설치 확장·원본·커밋·구성요소·승인 상태·MCP 협상(전송·인증·리비전), 원본별 집계, 원본 정책 미리보기
 * (강제를 켜면 무엇이 막히는지 — 서버가 설치 경로와 같은 판정으로 계산). 서버 플래그가 꺼져 있으면 API 가 404 라
 * 꺼져 있다는 안내만 보인다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Package, Search, ShieldAlert, Layers } from "lucide-react";
import { PageHeader, PageBody, Card, CardHeader, CardTitle, CardContent, Button, Table, Th, Td, Badge, Input } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient, ApiError } from "@/lib/api-client";
import {
  inventoryQueryString,
  negotiationSummary,
  shortCommit,
  type InventoryFilter,
  type InventoryItem,
  type InventoryPage,
  type InventorySource,
  type PolicyPreview,
} from "@/lib/extension-admin-inventory";

type View = "installs" | "sources" | "preview";
const EMPTY_FILTER: InventoryFilter = { q: "", userId: "", source: "", status: "active" };
const selectCls = "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

export default function AdminExtensionsPage() {
  const t = useTranslations("adminExtensions");
  const [view, setView] = useState<View>("installs");
  const [draft, setDraft] = useState<InventoryFilter>(EMPTY_FILTER);
  const [filter, setFilter] = useState<InventoryFilter>(EMPTY_FILTER);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [sources, setSources] = useState<InventorySource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PolicyPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const fetchPage = useCallback(async (f: InventoryFilter, after: string | null) => {
    setLoading(true); setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<InventoryPage>>(`/api/admin/extensions/inventory?${inventoryQueryString(f, after)}`);
      const page = r?.data;
      setItems((prev) => (after ? [...prev, ...(page?.items ?? [])] : page?.items ?? []));
      if (!after) setSources(page?.sources ?? []);
      setCursor(page?.nextCursor ?? null);
    } catch (e) {
      if (isNotFound(e)) setDisabled(true);
      else setError(e instanceof Error ? e.message : t("loadError"));
    } finally { setLoading(false); }
  }, [t]);

  useEffect(() => { void fetchPage(filter, null); }, [fetchPage, filter]);

  async function runPreview() {
    setPreviewing(true); setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<PolicyPreview>>("/api/admin/extensions/policy-preview");
      setPreview(r?.data ?? null);
    } catch (e) {
      if (isNotFound(e)) setDisabled(true);
      else setError(e instanceof Error ? e.message : t("loadError"));
    } finally { setPreviewing(false); }
  }

  const tabBtn = (v: View, label: string) => (
    <Button size="sm" variant={view === v ? "default" : "ghost"} aria-pressed={view === v} onClick={() => setView(v)}>{label}</Button>
  );

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <PageBody>
        {disabled ? (
          <Card><CardContent><p className="text-sm text-muted" role="status">{t("disabled")}</p></CardContent></Card>
        ) : (
          <div className="space-y-4">
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex flex-wrap gap-2" role="group" aria-label={t("viewLabel")}>
              {tabBtn("installs", t("viewInstalls"))}
              {tabBtn("sources", t("viewSources"))}
              {tabBtn("preview", t("viewPreview"))}
            </div>

            {view !== "preview" && (
              <Card>
                <CardContent>
                  <form
                    className="grid gap-2 sm:grid-cols-5"
                    onSubmit={(e) => { e.preventDefault(); setFilter({ ...draft }); }}
                  >
                    <Input value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} placeholder={t("searchPlaceholder")} aria-label={t("searchPlaceholder")} />
                    <Input value={draft.userId} onChange={(e) => setDraft({ ...draft, userId: e.target.value })} placeholder={t("userIdPlaceholder")} aria-label={t("userIdPlaceholder")} />
                    <Input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder={t("sourcePlaceholder")} aria-label={t("sourcePlaceholder")} />
                    <select className={selectCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as InventoryFilter["status"] })} aria-label={t("status")}>
                      <option value="active">{t("statusActive")}</option>
                      <option value="removed">{t("statusRemoved")}</option>
                      <option value="">{t("statusAll")}</option>
                    </select>
                    <Button size="sm" type="submit"><Search className="h-3.5 w-3.5" /> {t("search")}</Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {view === "installs" && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-4 w-4" /> {t("installsTitle")}</CardTitle></CardHeader>
                <CardContent>
                  {items.length === 0 && !loading ? <p className="text-xs text-muted">{t("empty")}</p> : (
                    <div className="overflow-x-auto">
                      <Table>
                        <thead><tr>
                          <Th className="whitespace-nowrap">{t("owner")}</Th><Th className="whitespace-nowrap">{t("extension")}</Th><Th className="whitespace-nowrap">{t("source")}</Th>
                          <Th className="whitespace-nowrap">{t("components")}</Th><Th className="whitespace-nowrap">{t("approval")}</Th><Th className="whitespace-nowrap">{t("mcpNegotiation")}</Th><Th className="whitespace-nowrap">{t("status")}</Th>
                        </tr></thead>
                        <tbody>
                          {items.map((it) => (
                            <tr key={it.id}>
                              <Td><div className="text-sm">{it.owner.username ?? it.owner.id}</div><div className="text-[11px] text-muted">{it.owner.org ? t("orgOwner") : (it.owner.email ?? "")}</div></Td>
                              <Td><div className="text-sm">{it.name}</div><div className="text-[11px] text-muted">v{it.version} · {it.permissionState}</div></Td>
                              <Td className="min-w-[16rem] max-w-[28rem]">
                                <div className="break-all font-mono text-xs">{it.source.url}</div>
                                <div className="text-[11px] text-muted">{it.source.trackingRef ?? "HEAD"} · {shortCommit(it.source.commit)}</div>
                              </Td>
                              <Td className="whitespace-nowrap text-xs">
                                {it.componentsUnavailable ? <span className="text-muted">{t("componentsUnavailable")}</span> : t("componentCounts", {
                                  skills: it.components.skills.length, mcp: it.components.mcpServers.length, agents: it.components.agents.length,
                                })}
                              </Td>
                              <Td>
                                <div className="flex flex-wrap gap-1 whitespace-nowrap">
                                  {it.approval.draft > 0 && <Badge tone="warn">{t("draftCount", { n: it.approval.draft })}</Badge>}
                                  {it.approval.active > 0 && <Badge tone="success">{t("activeCount", { n: it.approval.active })}</Badge>}
                                  {it.approval.archived > 0 && <Badge>{t("archivedCount", { n: it.approval.archived })}</Badge>}
                                </div>
                              </Td>
                              <Td className="whitespace-nowrap text-[11px] text-muted">
                                {it.components.mcpServers.length === 0 ? "—" : negotiationSummary(it.components.mcpServers).map((line) => <div key={line}>{line}</div>)}
                              </Td>
                              <Td className="whitespace-nowrap"><Badge tone={it.status === "active" ? "success" : "neutral"}>{it.status === "active" ? t("statusActive") : t("statusRemoved")}</Badge></Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                  )}
                  {cursor && (
                    <div className="mt-3">
                      <Button size="sm" variant="ghost" disabled={loading} onClick={() => void fetchPage(filter, cursor)}>{t("loadMore")}</Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {view === "sources" && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> {t("sourcesTitle")}</CardTitle></CardHeader>
                <CardContent>
                  {sources.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                    <Table>
                      <thead><tr><Th>{t("source")}</Th><Th>{t("installs")}</Th><Th>{t("users")}</Th><Th>{t("lastInstalled")}</Th></tr></thead>
                      <tbody>
                        {sources.map((s) => (
                          <tr key={s.sourceUrl}>
                            <Td className="break-all font-mono text-xs">{s.sourceUrl}</Td><Td>{s.installs}</Td><Td>{s.users}</Td>
                            <Td className="text-xs text-muted">{new Date(s.lastInstalledAt).toLocaleString()}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            )}

            {view === "preview" && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> {t("previewTitle")}</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted">{t("previewHelp")}</p>
                  <Button size="sm" disabled={previewing} onClick={() => void runPreview()}>{previewing ? t("previewRunning") : t("previewRun")}</Button>
                  {preview && (
                    <div className="space-y-2" role="status">
                      <p className="text-sm">
                        {t("previewSummary", { checked: preview.checked, blocked: preview.blocked.length })}
                        {" "}<Badge tone={preview.enforced ? "warn" : "neutral"}>{preview.enforced ? t("enforcedOn") : t("enforcedOff")}</Badge>
                        {" "}<Badge>{preview.arbitraryUrlInstall}</Badge>
                      </p>
                      {preview.truncated && <p className="text-xs text-warn">{t("previewTruncated")}</p>}
                      {preview.blocked.length > 0 && (
                        <Table>
                          <thead><tr><Th>{t("owner")}</Th><Th>{t("extension")}</Th><Th>{t("source")}</Th><Th>{t("reason")}</Th><Th>{t("rule")}</Th></tr></thead>
                          <tbody>
                            {preview.blocked.map((b) => (
                              <tr key={b.extensionId}>
                                <Td>{b.owner.username ?? b.owner.id}</Td><Td>{b.name}</Td>
                                <Td className="break-all font-mono text-xs">{b.verdict.source}</Td>
                                <Td><Badge tone="danger">{b.verdict.reason}</Badge>{b.verdict.scope ? <span className="ml-1 text-[11px] text-muted">{b.verdict.scope === "organization" ? t("scopeOrg") : t("scopeGlobal")}</span> : null}</Td>
                                <Td className="font-mono text-[11px] text-muted">{b.verdict.rule !== undefined ? JSON.stringify(b.verdict.rule) : "—"}</Td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      )}
                      {preview.mcpServers && (
                        <div className="space-y-2 border-t border-border pt-3">
                          <h3 className="text-sm font-medium">{t("mcpPreviewTitle")}</h3>
                          <p className="text-xs text-muted">{t("mcpPreviewHelp")}</p>
                          {preview.mcpServers.unavailable ? (
                            <p className="text-xs text-warn">{t("mcpPreviewUnavailable")}</p>
                          ) : (
                            <p className="text-sm">
                              {t("mcpPreviewSummary", { checked: preview.mcpServers.checked, blocked: preview.mcpServers.blocked.length })}
                              {" "}<Badge tone={preview.mcpServers.enforced ? "warn" : "neutral"}>{preview.mcpServers.enforced ? t("enforcedOn") : t("enforcedOff")}</Badge>
                            </p>
                          )}
                          {preview.mcpServers.blocked.length > 0 && (
                            <Table>
                              <thead><tr><Th>{t("owner")}</Th><Th>{t("extension")}</Th><Th>{t("mcpServer")}</Th><Th>{t("mcpIdentity")}</Th><Th>{t("reason")}</Th><Th>{t("rule")}</Th></tr></thead>
                              <tbody>
                                {preview.mcpServers.blocked.map((b) => (
                                  <tr key={b.server.id}>
                                    <Td>{b.owner.username ?? b.owner.id}</Td><Td>{b.name}</Td>
                                    <Td>{b.server.name} <span className="text-[11px] text-muted">{b.server.transport}</span></Td>
                                    <Td className="break-all font-mono text-xs">{b.verdict.server}</Td>
                                    <Td><Badge tone="danger">{b.verdict.reason}</Badge>{b.verdict.scope ? <span className="ml-1 text-[11px] text-muted">{b.verdict.scope === "organization" ? t("scopeOrg") : t("scopeGlobal")}</span> : null}</Td>
                                    <Td className="font-mono text-[11px] text-muted">{b.verdict.rule !== undefined ? JSON.stringify(b.verdict.rule) : "—"}</Td>
                                  </tr>
                                ))}
                              </tbody>
                            </Table>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </PageBody>
    </>
  );
}
