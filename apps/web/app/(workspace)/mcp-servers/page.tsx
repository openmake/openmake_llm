"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Server, Boxes, Plus, Loader2, X } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { McpTabs } from "@/components/hub-tabs";

/* ── 타입 ────────────────────────────────────────────────── */
type Transport = "stdio" | "SSE" | "HTTP";
type ConnStatus = "connected" | "degraded" | "disconnected";

interface McpServer {
  id: string;
  name: string;
  transport: Transport;
  toolCount: number;
  status: ConnStatus;
  latencyMs: number | null;
  lastChecked: string;
}

/* ── 백엔드 응답 타입 (GET /api/mcp/servers) ──────────────── */
interface ApiMcpServer {
  id: string;
  name: string;
  transport_type: "stdio" | "sse" | "streamable-http";
  connectionStatus?: string;
  toolCount?: number;
  lastPing?: string | null;
}

const TRANSPORT_MAP: Record<ApiMcpServer["transport_type"], Transport> = {
  stdio: "stdio",
  sse: "SSE",
  "streamable-http": "HTTP",
};

function mapStatus(s?: string): ConnStatus {
  if (s === "connected") return "connected";
  if (s === "degraded") return "degraded";
  return "disconnected";
}

type Translator = (key: string, values?: Record<string, number>) => string;

function relativeTime(iso: string | null | undefined, t: Translator): string {
  if (!iso) return "—";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "—";
  const diffSec = Math.round((Date.now() - time) / 1000);
  if (diffSec < 60) return t("justNow");
  if (diffSec < 3600) return t("minutesAgo", { count: Math.floor(diffSec / 60) });
  if (diffSec < 86400) return t("hoursAgo", { count: Math.floor(diffSec / 3600) });
  return t("daysAgo", { count: Math.floor(diffSec / 86400) });
}

function mapServer(s: ApiMcpServer, t: Translator): McpServer {
  return {
    id: s.id,
    name: s.name,
    transport: TRANSPORT_MAP[s.transport_type] ?? "stdio",
    toolCount: s.toolCount ?? 0,
    status: mapStatus(s.connectionStatus),
    // 백엔드는 지연(latency) 수치를 제공하지 않음 — 표시 생략
    latencyMs: null,
    lastChecked: relativeTime(s.lastPing, t),
  };
}

/* ── Draft 타입 ─────────────────────────────────────────────── */
interface DraftServer {
  id: string;
  name?: string;
  git_url?: string;
  status: string;
  manifest_meta?: {
    conventionFindings?: { severity: string }[];
  };
}

/* ── Git URL 등록 모달 ──────────────────────────────────────── */
function GitImportModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useTranslations("mcpServers");
  const [gitUrl, setGitUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await ApiClient.post("/api/mcp/servers/import-from-git", {
        gitUrl,
        ...(accessToken ? { accessToken } : {}),
      });
      setGitUrl("");
      setAccessToken("");
      onClose();
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("importError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">{t("importTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-2">
              Git URL <span className="text-danger">*</span>
            </label>
            <input
              type="url"
              required
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/org/repo"
              className="h-9 w-full rounded-md border border-border-strong bg-app px-3 text-sm text-fg outline-none transition focus:border-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-fg-2">
              {t("accessTokenLabel")}
            </label>
            <input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="ghp_xxxx"
              className="h-9 w-full rounded-md border border-border-strong bg-app px-3 text-sm text-fg outline-none transition focus:border-accent"
            />
          </div>
          {error && (
            <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || !gitUrl}>
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("register")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── 목업 데이터 — TODO: API 연동 (GET /api/mcp/servers) ──── */
function buildMockServers(t: Translator): McpServer[] {
  return [
  {
    id: "filesystem",
    name: "filesystem",
    transport: "stdio",
    toolCount: 8,
    status: "connected",
    latencyMs: 12,
    lastChecked: t("justNow"),
  },
  {
    id: "github",
    name: "github",
    transport: "HTTP",
    toolCount: 21,
    status: "connected",
    latencyMs: 184,
    lastChecked: t("minutesAgo", { count: 1 }),
  },
  {
    id: "postgres-prod",
    name: "postgres-prod",
    transport: "stdio",
    toolCount: 5,
    status: "degraded",
    latencyMs: 842,
    lastChecked: t("minutesAgo", { count: 2 }),
  },
  {
    id: "slack-events",
    name: "slack-events",
    transport: "SSE",
    toolCount: 11,
    status: "connected",
    latencyMs: 76,
    lastChecked: t("minutesAgo", { count: 3 }),
  },
  {
    id: "weather-api",
    name: "weather-api",
    transport: "HTTP",
    toolCount: 3,
    status: "disconnected",
    latencyMs: null,
    lastChecked: t("minutesAgo", { count: 12 }),
  },
  ];
}

const STATUS_META: Record<
  ConnStatus,
  { labelKey: string; tone: "success" | "warn" | "danger" }
> = {
  connected: { labelKey: "status.connected", tone: "success" },
  degraded: { labelKey: "status.degraded", tone: "warn" },
  disconnected: { labelKey: "status.disconnected", tone: "danger" },
};

const TRANSPORT_TONE: Record<Transport, "accent" | "neutral"> = {
  stdio: "neutral",
  SSE: "accent",
  HTTP: "accent",
};

type TabId = "servers" | "drafts";

export default function McpServersPage() {
  const t = useTranslations("mcpServers");
  const [tab, setTab] = useState<TabId>("servers");
  const [modalOpen, setModalOpen] = useState(false);
  const [servers, setServers] = useState<McpServer[]>(() => buildMockServers(t));
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<DraftServer[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftActionLoading, setDraftActionLoading] = useState<Record<string, boolean>>({});

  async function loadDrafts() {
    setDraftsLoading(true);
    try {
      const res = await ApiClient.get<{ success: boolean; data: DraftServer[] }>(
        "/api/mcp/servers/drafts",
      );
      setDrafts(res?.data ?? []);
    } catch {
      /* 실패 시 빈 목록 유지 */
    } finally {
      setDraftsLoading(false);
    }
  }

  async function handleApproveDraft(id: string) {
    setDraftActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await ApiClient.post(`/api/mcp/servers/${id}/approve`, {});
      await loadDrafts();
    } catch {
      /* 실패 시 현상 유지 */
    } finally {
      setDraftActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleRejectDraft(id: string) {
    setDraftActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await ApiClient.post(`/api/mcp/servers/${id}/reject`, {});
      await loadDrafts();
    } catch {
      /* 실패 시 현상 유지 */
    } finally {
      setDraftActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleConnect(id: string) {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await ApiClient.post<ApiEnvelope<{ status: string }>>(`/api/mcp/servers/${id}/connect`, {});
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "connected" } : s)),
      );
    } catch {
      /* 실패 시 현상 유지 */
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleDisconnect(id: string) {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await ApiClient.post<ApiEnvelope<{ disconnected: boolean }>>(`/api/mcp/servers/${id}/disconnect`, {});
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, status: "disconnected" } : s)),
      );
    } catch {
      /* 실패 시 현상 유지 */
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<ApiEnvelope<{ servers: ApiMcpServer[] }>>(
          "/api/mcp/servers",
        );
        if (cancelled) return;
        const list = res?.data?.servers ?? [];
        setServers(list.map((s) => mapServer(s, t)));
      } catch {
        // 401·네트워크 실패 등 → 목업 유지 (데모)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "drafts") {
      void loadDrafts();
    }
  }, [tab]);

  return (
    <>
      <GitImportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          setTab("drafts");
          void loadDrafts();
        }}
      />
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <Button variant="outline" size="sm">
              <Boxes className="h-4 w-4" />
              {t("catalog")}
            </Button>
            <Button size="sm" onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("addServer")}
            </Button>
          </>
        }
      />
      <McpTabs />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 탭 */}
        <div className="mb-4 inline-flex rounded-pill border border-border bg-surface-2 p-1">
          {(["servers", "drafts"] as TabId[]).map((tabId) => (
            <button
              key={tabId}
              type="button"
              onClick={() => setTab(tabId)}
              className={cn(
                "rounded-pill px-4 py-1.5 text-xs font-medium transition",
                tab === tabId
                  ? "bg-surface text-fg shadow-1"
                  : "text-muted hover:text-fg",
              )}
            >
              {tabId === "servers" ? t("tabServers") : "Draft"}
            </button>
          ))}
        </div>

        {/* 서버 목록 탭 */}
        {tab === "servers" && (
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>{t("colName")}</Th>
                <Th>{t("colType")}</Th>
                <Th className="text-right">{t("colToolCount")}</Th>
                <Th>{t("colStatus")}</Th>
                <Th className="text-right">{t("colLatency")}</Th>
                <Th>{t("colLastChecked")}</Th>
                <Th>{t("colAction")}</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <Td colSpan={7}>
                    <div className="py-12 text-center text-muted">{t("loading")}</div>
                  </Td>
                </tr>
              ) : servers.length === 0 ? (
                <tr>
                  <Td colSpan={7}>
                    <div className="py-12 text-center text-muted">
                      {t("emptyServers")}
                    </div>
                  </Td>
                </tr>
              ) : (
                servers.map((s) => {
                  const meta = STATUS_META[s.status];
                  const isActing = actionLoading[s.id] ?? false;
                  return (
                    <tr key={s.id} className="transition hover:bg-surface-2">
                      <Td>
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-faint" />
                          <span className="font-medium text-fg">{s.name}</span>
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={TRANSPORT_TONE[s.transport]}>
                          <span className="font-mono">{s.transport}</span>
                        </Badge>
                      </Td>
                      <Td className="text-right font-mono text-fg">
                        {s.toolCount}
                      </Td>
                      <Td>
                        <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
                      </Td>
                      <Td className="text-right font-mono">
                        {s.latencyMs == null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span
                            className={
                              s.latencyMs > 500 ? "text-warn" : "text-fg-2"
                            }
                          >
                            {s.latencyMs}ms
                          </span>
                        )}
                      </Td>
                      <Td className="text-faint">{s.lastChecked}</Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          {s.status === "connected" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isActing}
                              onClick={() => handleDisconnect(s.id)}
                            >
                              {isActing && <Loader2 className="h-3 w-3 animate-spin" />}
                              {t("disconnect")}
                            </Button>
                          ) : s.status === "degraded" ? (
                            <>
                              <Button
                                size="sm"
                                disabled={isActing}
                                onClick={() => handleConnect(s.id)}
                              >
                                {isActing && <Loader2 className="h-3 w-3 animate-spin" />}
                                {t("reconnect")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isActing}
                                onClick={() => handleDisconnect(s.id)}
                              >
                                {t("disconnect")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              size="sm"
                              disabled={isActing}
                              onClick={() => handleConnect(s.id)}
                            >
                              {isActing && <Loader2 className="h-3 w-3 animate-spin" />}
                              {t("connect")}
                            </Button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </Card>
        )}

        {/* Draft 탭 */}
        {tab === "drafts" && (
          <Card className="overflow-hidden">
            <Table>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>Git URL</Th>
                  <Th>{t("colName")}</Th>
                  <Th>{t("colStatus")}</Th>
                  <Th>{t("draftColRisk")}</Th>
                  <Th>{t("colAction")}</Th>
                </tr>
              </thead>
              <tbody>
                {draftsLoading ? (
                  <tr>
                    <Td colSpan={6}>
                      <div className="py-12 text-center text-muted">{t("loading")}</div>
                    </Td>
                  </tr>
                ) : drafts.length === 0 ? (
                  <tr>
                    <Td colSpan={6}>
                      <div className="py-12 text-center text-muted">
                        {t("emptyDrafts")}
                      </div>
                    </Td>
                  </tr>
                ) : (
                  drafts.map((d) => {
                    const hasError = d.manifest_meta?.conventionFindings?.some(
                      (f) => f.severity === "error",
                    );
                    const isActing = draftActionLoading[d.id] ?? false;
                    return (
                      <tr key={d.id} className="transition hover:bg-surface-2">
                        <Td className="font-mono text-xs text-fg-2">
                          {d.id.slice(0, 8)}
                        </Td>
                        <Td className="max-w-xs truncate text-xs text-fg-2">
                          {d.git_url ?? "—"}
                        </Td>
                        <Td className="text-sm text-fg">{d.name ?? "—"}</Td>
                        <Td>
                          <Badge tone={d.status === "approved" ? "success" : d.status === "rejected" ? "danger" : "neutral"}>
                            {d.status}
                          </Badge>
                        </Td>
                        <Td>
                          {hasError ? (
                            <span className="text-sm text-danger">{t("riskWarning")}</span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </Td>
                        <Td>
                          {d.status === "pending" && (
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                disabled={isActing}
                                onClick={() => void handleApproveDraft(d.id)}
                              >
                                {isActing && (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                )}
                                {t("approve")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isActing}
                                onClick={() => void handleRejectDraft(d.id)}
                              >
                                {t("reject")}
                              </Button>
                            </div>
                          )}
                        </Td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
