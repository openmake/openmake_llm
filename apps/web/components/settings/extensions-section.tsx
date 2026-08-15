"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Package, Trash2, Loader2, ChevronDown, Puzzle, Server } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

interface UserExtension {
  id: string;
  name: string;
  version: string;
  description: string | null;
  source_url: string;
  source_ref: string;
  created_at?: string;
}

interface ExtensionComponents {
  skills: Array<{ id: string; name: string; status: string }>;
  mcpServers: Array<{ id: string; name: string; status: string; enabled: boolean }>;
}

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

  useEffect(() => {
    void load();
  }, [load]);

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
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("removeAria")}
                      onClick={() => void remove(ext.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
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
      </CardContent>
    </Card>
  );
}
