"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Package, Trash2, Loader2, ChevronDown, ChevronLeft, ChevronRight, Puzzle, Server, RefreshCw, Share2, Download, Store, Plus } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";

interface UserExtension {
  id: string;
  name: string;
  version: string;
  description: string | null;
  source_url: string;
  source_ref: string;
  visibility?: "private" | "shared";
  created_at?: string;
}

interface GalleryExtension extends UserExtension {
  owned: boolean;
}

type GalleryInstallState =
  | { state: "installing" }
  | { state: "installed"; updated: boolean; upToDate: boolean }
  | { state: "failed" };

interface CatalogPlugin {
  name: string;
  description?: string;
  version?: string;
  /** 동기화 시점 사전 판정 — false 면 설치 구성요소(스킬/MCP) 없음 → UI 미노출 */
  installable?: boolean;
  /** 마켓플레이스 분류 (marketplace.json category) — 카테고리 필터용 */
  category?: string;
}

/** 카탈로그 페이지 크기 — 대형 마켓플레이스(수백 개) 스크롤 방지 */
const CATALOG_PAGE_SIZE = 20;
/** category 미보유 플러그인의 필터 버킷 키 */
const UNCATEGORIZED = "__none__";
const CATALOG_SELECT_CLS =
  "min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-fg outline-none focus:border-border-strong sm:max-w-[240px]";

interface CatalogSource {
  id: string;
  url: string;
  name: string;
  description: string | null;
  plugins: CatalogPlugin[];
  last_synced_at?: string;
}

interface ExtensionComponents {
  skills: Array<{ id: string; name: string; status: string }>;
  mcpServers: Array<{ id: string; name: string; status: string; enabled: boolean }>;
}

type UpdateCheckState =
  | { state: "checking" }
  | { state: "latest" }
  | { state: "available"; latestVersion: string | null }
  | { state: "failed" };

/**
 * 확장 번들 (Agent Plugins v1) 관리 — 설치는 채팅 도구 import_extension_from_git,
 * 여기서는 설치 목록/구성요소 상태 조회와 번들 단위 제거만 제공한다 (PR #499 백엔드).
 */
export function ExtensionsSection() {
  const t = useTranslations("extensions");
  const [extensions, setExtensions] = useState<UserExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [components, setComponents] = useState<Record<string, ExtensionComponents>>({});
  const [detailLoading, setDetailLoading] = useState(false);
  const [updateChecks, setUpdateChecks] = useState<Record<string, UpdateCheckState>>({});
  const [gallery, setGallery] = useState<GalleryExtension[]>([]);
  const [galleryInstalls, setGalleryInstalls] = useState<Record<string, GalleryInstallState>>({});
  const [sharing, setSharing] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogSource[]>([]);
  const [catalogInstalls, setCatalogInstalls] = useState<Record<string, GalleryInstallState>>({});
  const [catalogUrl, setCatalogUrl] = useState("");
  const [catalogBusy, setCatalogBusy] = useState<string | null>(null);
  // 카탈로그 단일 브라우저 — 소스/카테고리 셀렉트 + 페이지 (16개 소스 스택 대신 한 리스트)
  const [catalogSource, setCatalogSource] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("");
  const [catalogPage, setCatalogPage] = useState(0);
  const isAdmin = useAppStore((s) => s.auth.currentUser?.role === "admin");

  // 파생값: 설치 가능 항목 평면화 → 소스 필터 → 카테고리 필터 → 페이지
  const catalogEntries = catalog.flatMap((src) =>
    src.plugins
      .filter((p) => p.installable !== false)
      .map((p) => ({ plugin: p, srcId: src.id, srcName: src.name, multiPlugin: src.plugins.length > 1 })),
  );
  const sourceScoped = catalogSource ? catalogEntries.filter((e) => e.srcId === catalogSource) : catalogEntries;
  const catalogCategoryCounts = new Map<string, number>();
  for (const e of sourceScoped) {
    const c = e.plugin.category ?? UNCATEGORIZED;
    catalogCategoryCounts.set(c, (catalogCategoryCounts.get(c) ?? 0) + 1);
  }
  const catalogCategories = [...catalogCategoryCounts.keys()].sort();
  const catalogFiltered = catalogCategory
    ? sourceScoped.filter((e) => (e.plugin.category ?? UNCATEGORIZED) === catalogCategory)
    : sourceScoped;
  const catalogTotalPages = Math.max(1, Math.ceil(catalogFiltered.length / CATALOG_PAGE_SIZE));
  const catalogPageClamped = Math.min(catalogPage, catalogTotalPages - 1);
  const catalogPageEntries = catalogFiltered.slice(
    catalogPageClamped * CATALOG_PAGE_SIZE,
    (catalogPageClamped + 1) * CATALOG_PAGE_SIZE,
  );
  const selectedSource = catalogSource ? catalog.find((s) => s.id === catalogSource) : undefined;

  const load = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApiSuccess<{ extensions: UserExtension[] }>>("/api/users/me/extensions");
      setExtensions(res?.data?.extensions ?? []);
    } catch {
      /* 비로그인/실패 — 빈 목록 유지 */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGallery = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApiSuccess<{ extensions: GalleryExtension[]; catalog?: CatalogSource[] }>>(
        "/api/users/me/extensions/gallery",
      );
      setGallery(res?.data?.extensions ?? []);
      setCatalog(res?.data?.catalog ?? []);
    } catch {
      /* 실패 — 빈 갤러리 유지 */
    }
  }, []);

  useEffect(() => {
    void load();
    void loadGallery();
  }, [load, loadGallery]);

  async function toggleDetail(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!components[id]) {
      setDetailLoading(true);
      try {
        const res = await ApiClient.get<ApiSuccess<{ components: ExtensionComponents }>>(
          `/api/users/me/extensions/${id}`,
        );
        if (res?.data?.components) {
          setComponents((prev) => ({ ...prev, [id]: res.data.components }));
        }
      } catch {
        /* 상세 실패 — 요약만 표시 */
      } finally {
        setDetailLoading(false);
      }
    }
  }

  async function checkUpdate(id: string) {
    setUpdateChecks((prev) => ({ ...prev, [id]: { state: "checking" } }));
    try {
      const res = await ApiClient.post<ApiSuccess<{ updateAvailable: boolean; latestVersion: string | null }>>(
        `/api/users/me/extensions/${id}/update-check`,
        {},
      );
      if (res?.data?.updateAvailable) {
        setUpdateChecks((prev) => ({ ...prev, [id]: { state: "available", latestVersion: res.data.latestVersion } }));
      } else {
        setUpdateChecks((prev) => ({ ...prev, [id]: { state: "latest" } }));
      }
    } catch {
      setUpdateChecks((prev) => ({ ...prev, [id]: { state: "failed" } }));
    }
  }

  async function toggleShare(ext: UserExtension) {
    if (sharing) return;
    setSharing(ext.id);
    const next = ext.visibility === "shared" ? "private" : "shared";
    try {
      await ApiClient.patch(`/api/users/me/extensions/${ext.id}/visibility`, { visibility: next });
      setExtensions((list) => list.map((e) => (e.id === ext.id ? { ...e, visibility: next } : e)));
      void loadGallery();
    } catch {
      /* 실패 — 상태 유지 */
    } finally {
      setSharing(null);
    }
  }

  async function installFromGallery(id: string) {
    setGalleryInstalls((prev) => ({ ...prev, [id]: { state: "installing" } }));
    try {
      const res = await ApiClient.post<ApiSuccess<{ updated: boolean; upToDate: boolean }>>(
        `/api/users/me/extensions/gallery/${id}/install`,
        {},
      );
      setGalleryInstalls((prev) => ({
        ...prev,
        [id]: { state: "installed", updated: !!res?.data?.updated, upToDate: !!res?.data?.upToDate },
      }));
      void load();
    } catch {
      setGalleryInstalls((prev) => ({ ...prev, [id]: { state: "failed" } }));
    }
  }

  async function installFromCatalog(sourceId: string, plugin?: string) {
    const key = `${sourceId}:${plugin ?? ""}`;
    setCatalogInstalls((prev) => ({ ...prev, [key]: { state: "installing" } }));
    try {
      const res = await ApiClient.post<ApiSuccess<{ updated: boolean; upToDate: boolean }>>(
        `/api/users/me/extensions/catalog/${sourceId}/install`,
        plugin ? { plugin } : {},
      );
      setCatalogInstalls((prev) => ({
        ...prev,
        [key]: { state: "installed", updated: !!res?.data?.updated, upToDate: !!res?.data?.upToDate },
      }));
      void load();
    } catch {
      setCatalogInstalls((prev) => ({ ...prev, [key]: { state: "failed" } }));
    }
  }

  async function registerCatalogSource() {
    const url = catalogUrl.trim();
    if (!url || catalogBusy) return;
    setCatalogBusy("register");
    try {
      await ApiClient.post("/api/users/me/extensions/catalog", { url });
      setCatalogUrl("");
      void loadGallery();
    } catch {
      /* 실패 — 입력 유지, 재시도 가능 */
    } finally {
      setCatalogBusy(null);
    }
  }

  async function syncCatalogSource(id: string) {
    if (catalogBusy) return;
    setCatalogBusy(id);
    try {
      await ApiClient.post(`/api/users/me/extensions/catalog/${id}/sync`, {});
      void loadGallery();
    } catch {
      /* 실패 */
    } finally {
      setCatalogBusy(null);
    }
  }

  async function removeCatalogSource(id: string) {
    if (!window.confirm(t("catalog.removeConfirm"))) return;
    try {
      await ApiClient.del(`/api/users/me/extensions/catalog/${id}`);
      setCatalog((list) => list.filter((s) => s.id !== id));
    } catch {
      /* 실패 */
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t("removeConfirm"))) return;
    const prev = extensions;
    setExtensions((list) => list.filter((e) => e.id !== id));
    try {
      await ApiClient.del(`/api/users/me/extensions/${id}`);
    } catch {
      setExtensions(prev); // 실패 시 롤백
    }
  }

  function statusLabel(status: string, enabled?: boolean) {
    if (status === "active" && enabled === false) return t("status.disabled");
    if (status === "active") return t("status.active");
    if (status === "draft") return t("status.draft");
    if (status === "archived") return t("status.archived");
    return status;
  }

  function statusClass(status: string) {
    if (status === "active") return "text-success";
    if (status === "draft") return "text-warn";
    return "text-muted";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="mt-1 text-xs text-muted">{t("description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-xs text-fg-2">{t("installHint")}</p>

        {loading ? (
          <div className="flex justify-center py-10 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : extensions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center text-muted">
            <Package className="h-8 w-8 opacity-50" />
            <p className="text-sm">{t("empty")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {extensions.map((ext) => {
              const open = openId === ext.id;
              const comp = components[ext.id];
              const check = updateChecks[ext.id];
              return (
                <li key={ext.id} className="rounded-lg border border-border">
                  <div className="flex items-center gap-3 p-3.5">
                    <Package className="h-4 w-4 shrink-0 text-accent" />
                    <button
                      type="button"
                      onClick={() => void toggleDetail(ext.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-sm font-medium text-fg">
                        {ext.name}
                        <span className="ml-1.5 font-mono text-xs text-muted">v{ext.version}</span>
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {ext.description || ext.source_url}
                        <span className="ml-1.5 font-mono">@{ext.source_ref.slice(0, 7)}</span>
                      </p>
                    </button>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`}
                    />
                    {check && check.state !== "checking" && (
                      <span
                        className={`shrink-0 whitespace-nowrap text-xs ${
                          check.state === "available" ? "text-warn" : check.state === "latest" ? "text-success" : "text-muted"
                        }`}
                      >
                        {check.state === "available"
                          ? check.latestVersion
                            ? t("update.available", { version: check.latestVersion })
                            : t("update.availableNoVersion")
                          : check.state === "latest"
                          ? t("update.latest")
                          : t("update.failed")}
                      </span>
                    )}
                    {ext.visibility === "shared" && (
                      <span className="shrink-0 whitespace-nowrap text-xs text-accent">{t("share.shared")}</span>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("share.toggleAria")}
                      disabled={sharing === ext.id}
                      onClick={() => void toggleShare(ext)}
                    >
                      {sharing === ext.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Share2 className={`h-4 w-4 ${ext.visibility === "shared" ? "text-accent" : ""}`} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("update.checkAria")}
                      disabled={check?.state === "checking"}
                      onClick={() => void checkUpdate(ext.id)}
                    >
                      {check?.state === "checking" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeAria")}
                      onClick={() => void remove(ext.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {check?.state === "available" && (
                    <p className="border-t border-border px-3.5 py-2 text-xs text-warn">{t("update.hint")}</p>
                  )}
                  {open && (
                    <div className="space-y-3 border-t border-border px-3.5 py-3">
                      {detailLoading && !comp ? (
                        <div className="flex justify-center py-4 text-muted">
                          <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                      ) : comp ? (
                        <>
                          <div>
                            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-2">
                              <Puzzle className="h-3.5 w-3.5" /> {t("skills")} ({comp.skills.length})
                            </p>
                            {comp.skills.length === 0 ? (
                              <p className="text-xs text-muted">{t("none")}</p>
                            ) : (
                              <ul className="space-y-1">
                                {comp.skills.map((s) => (
                                  <li key={s.id} className="flex items-center justify-between text-xs">
                                    <span className="truncate text-fg">{s.name}</span>
                                    <span className={statusClass(s.status)}>{statusLabel(s.status)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-2">
                              <Server className="h-3.5 w-3.5" /> {t("mcpServers")} ({comp.mcpServers.length})
                            </p>
                            {comp.mcpServers.length === 0 ? (
                              <p className="text-xs text-muted">{t("none")}</p>
                            ) : (
                              <ul className="space-y-1">
                                {comp.mcpServers.map((s) => (
                                  <li key={s.id} className="flex items-center justify-between text-xs">
                                    <span className="truncate text-fg">{s.name}</span>
                                    <span className={statusClass(s.status)}>{statusLabel(s.status, s.enabled)}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <p className="text-[11px] text-muted">{t("approvalHint")}</p>
                        </>
                      ) : (
                        <p className="text-xs text-muted">{t("detailFailed")}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 워크스페이스 갤러리 (Phase 3) — shared 확장, 설치는 본인 계정 ingest 재실행 */}
        <div className="border-t border-border pt-4">
          <p className="mb-1 text-sm font-medium text-fg">{t("gallery.title")}</p>
          <p className="mb-3 text-xs text-muted">{t("gallery.description")}</p>
          {gallery.length === 0 ? (
            <p className="text-xs text-muted">{t("gallery.empty")}</p>
          ) : (
            <ul className="space-y-2">
              {gallery.map((g) => {
                const install = galleryInstalls[g.id];
                return (
                  <li key={g.id} className="flex items-center gap-3 rounded-lg border border-border p-3.5">
                    <Share2 className="h-4 w-4 shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">
                        {g.name}
                        <span className="ml-1.5 font-mono text-xs text-muted">v{g.version}</span>
                        {g.owned && <span className="ml-1.5 text-xs text-muted">{t("gallery.owned")}</span>}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {g.description || g.source_url}
                        <span className="ml-1.5 font-mono">@{g.source_ref.slice(0, 7)}</span>
                      </p>
                    </div>
                    {install?.state === "installed" && (
                      <span className="shrink-0 whitespace-nowrap text-xs text-success">
                        {install.upToDate
                          ? t("gallery.upToDate")
                          : install.updated
                          ? t("gallery.updatedDone")
                          : t("gallery.installed")}
                      </span>
                    )}
                    {install?.state === "failed" && (
                      <span className="shrink-0 whitespace-nowrap text-xs text-muted">{t("gallery.failed")}</span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={install?.state === "installing"}
                      onClick={() => void installFromGallery(g.id)}
                    >
                      {install?.state === "installing" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                      {t("gallery.install")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* admin 큐레이션 카탈로그 — 등록된 소스의 플러그인 목록, 설치는 본인 계정 ingest */}
        <div className="border-t border-border pt-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-fg">
            <Store className="h-4 w-4 text-accent" /> {t("catalog.title")}
          </p>
          <p className="mb-3 text-xs text-muted">{t("catalog.description")}</p>

          {isAdmin && (
            <div className="mb-3 flex items-center gap-2">
              <input
                value={catalogUrl}
                onChange={(e) => setCatalogUrl(e.target.value)}
                placeholder={t("catalog.urlPlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-border-strong"
              />
              <Button
                size="sm"
                disabled={catalogBusy === "register" || !catalogUrl.trim()}
                onClick={() => void registerCatalogSource()}
              >
                {catalogBusy === "register" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {t("catalog.register")}
              </Button>
            </div>
          )}

          {catalog.length === 0 ? (
            <p className="text-xs text-muted">{t("catalog.empty")}</p>
          ) : (
            <div className="rounded-lg border border-border">
              {/* 소스·카테고리 셀렉트 — 16개 소스 스택 대신 한 화면 단일 리스트 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
                <select
                  value={catalogSource}
                  aria-label={t("catalog.sourceAria")}
                  onChange={(e) => {
                    setCatalogSource(e.target.value);
                    setCatalogCategory("");
                    setCatalogPage(0);
                  }}
                  className={CATALOG_SELECT_CLS}
                >
                  <option value="">{t("catalog.sourceAll", { count: catalogEntries.length })}</option>
                  {catalog.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.plugins.filter((p) => p.installable !== false).length})
                    </option>
                  ))}
                </select>
                {catalogCategories.length > 1 && (
                  <select
                    value={catalogCategory}
                    aria-label={t("catalog.categoryAria")}
                    onChange={(e) => {
                      setCatalogCategory(e.target.value);
                      setCatalogPage(0);
                    }}
                    className={CATALOG_SELECT_CLS}
                  >
                    <option value="">{t("catalog.categoryAll", { count: sourceScoped.length })}</option>
                    {catalogCategories.map((c) => (
                      <option key={c} value={c}>
                        {c === UNCATEGORIZED ? t("catalog.uncategorized") : c} ({catalogCategoryCounts.get(c)})
                      </option>
                    ))}
                  </select>
                )}
                {isAdmin && selectedSource && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("catalog.syncAria")}
                      disabled={catalogBusy === selectedSource.id}
                      onClick={() => void syncCatalogSource(selectedSource.id)}
                    >
                      {catalogBusy === selectedSource.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("catalog.removeAria")}
                      onClick={() => void removeCatalogSource(selectedSource.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
              {selectedSource && (
                <p className="truncate border-b border-border px-3.5 py-1.5 font-mono text-[11px] text-muted">
                  {selectedSource.url}
                  <span className="ml-1.5 font-sans">
                    {t("catalog.installableCount", {
                      count: sourceScoped.length,
                      total: selectedSource.plugins.length,
                    })}
                  </span>
                </p>
              )}
              {catalogFiltered.length === 0 ? (
                <p className="px-3.5 py-2.5 text-xs text-muted">{t("catalog.noneInstallable")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {catalogPageEntries.map((e) => {
                    const p = e.plugin;
                    const key = `${e.srcId}:${e.multiPlugin ? p.name : ""}`;
                    const st = catalogInstalls[key];
                    return (
                      <li key={`${e.srcId}:${p.name}`} className="flex items-center gap-3 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-fg">
                            {p.name}
                            {p.version && <span className="ml-1.5 font-mono text-xs text-muted">v{p.version}</span>}
                            {!catalogSource && (
                              <span className="ml-1.5 rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">
                                {e.srcName}
                              </span>
                            )}
                          </p>
                          {p.description && <p className="mt-0.5 truncate text-xs text-muted">{p.description}</p>}
                        </div>
                        {st?.state === "installed" && (
                          <span className="shrink-0 whitespace-nowrap text-xs text-success">
                            {st.upToDate ? t("gallery.upToDate") : st.updated ? t("gallery.updatedDone") : t("gallery.installed")}
                          </span>
                        )}
                        {st?.state === "failed" && (
                          <span className="shrink-0 whitespace-nowrap text-xs text-muted">{t("gallery.failed")}</span>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={st?.state === "installing"}
                          onClick={() => void installFromCatalog(e.srcId, e.multiPlugin ? p.name : undefined)}
                        >
                          {st?.state === "installing" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {t("gallery.install")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {catalogTotalPages > 1 && (
                <div className="flex items-center justify-center gap-1 border-t border-border px-3.5 py-1.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("catalog.prevPageAria")}
                    disabled={catalogPageClamped === 0}
                    onClick={() => setCatalogPage(catalogPageClamped - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-xs tabular-nums text-muted">
                    {t("catalog.pageInfo", { page: catalogPageClamped + 1, total: catalogTotalPages })}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("catalog.nextPageAria")}
                    disabled={catalogPageClamped >= catalogTotalPages - 1}
                    onClick={() => setCatalogPage(catalogPageClamped + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
