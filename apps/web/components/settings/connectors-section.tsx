"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Server, Boxes, Plus, Loader2, X, KeyRound, ClipboardCheck, AlertTriangle, Power, PowerOff, LogIn, LogOut, Zap, ZapOff } from "lucide-react";
import {
  Button,
  Badge,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { McpInstancesPanel } from "@/components/settings/mcp-instances-panel";

/**
 * MCP 서버(커넥터) 관리 — 구 /mcp-servers 페이지 본문을 설정 '커넥터' 탭으로 흡수한 것
 * (2026-07-17 사이드바 2차 통폐합). 구 라우트 /mcp-servers 는 /settings?tab=connectors 로 redirect.
 * 카탈로그(/mcp-catalog)는 독립 라우트로 유지 — 상단 버튼으로 오간다.
 */

/* ── 타입 ────────────────────────────────────────────────── */
type Transport = "stdio" | "SSE" | "HTTP";
type ConnStatus = "connected" | "degraded" | "disconnected";

interface McpServer {
  id: string;
  name: string;
  transport: Transport;
  toolCount: number;
  status: ConnStatus;
  /** 사용 여부 — false 면 목록에 남되 "사용 안 함"으로 표시된다(삭제와 달리 되돌릴 수 있다) */
  enabled: boolean;
  /** 자동 연결 — true 면 로그인/채팅 시작/재시작 복구 때 서버가 알아서 띄운다. false 는 손으로 [연결] */
  autoSpawn: boolean;
  /** 전역(admin 등록) 서버 — 부팅 시 붙으므로 자동 연결 토글이 없다 */
  isGlobal: boolean;
  /** OAuth 토큰 보유 — 로그아웃 버튼 노출 기준 */
  oauthConnected: boolean;
  /** 연결 실패 원인 코드 — 없으면 실패한 적이 없거나 현재 연결됨 */
  errorCode: string | null;
  /** 원인 원문 (코드만으로 부족한 진단용 — tooltip) */
  errorDetail: string | null;
  lastChecked: string;
  /** 편집 가능한 env 키 목록 (값은 서버가 마스킹하므로 키만 다룬다) */
  envKeys: string[];
  /** 그중 암호화 저장된(민감) 키 — 입력 시 password 필드로 렌더 */
  secretKeys: string[];
}

/* ── 백엔드 응답 타입 (GET /api/mcp/servers) ──────────────── */
interface ApiMcpServer {
  id: string;
  name: string;
  transport_type: "stdio" | "sse" | "streamable-http";
  connectionStatus?: string;
  toolCount?: number;
  lastPing?: string | null;
  /** 연결 실패 원인 — 그전엔 백엔드가 내려줘도 프론트가 버려서 화면에 원인이 없었다 */
  connectionError?: string | null;
  /** 사용 여부 — false 면 사용자가 "쓰지 않음"으로 치워둔 서버 */
  enabled?: boolean;
  /** 자동 연결 여부 — false 면 supervisor 가 띄우지 않아 재시작 뒤 수동 [연결]이 필요하다 */
  auto_spawn?: boolean;
  visibility?: "global" | "user_private" | "user_shared";
  /** 원격 서버에 OAuth 토큰이 저장돼 있는가 */
  oauthConnected?: boolean;
  /** 원인 코드(`auth_required` 등) — i18n 문구로 바꿔 보여준다 */
  connectionErrorCode?: string | null;
  /** 백엔드가 마스킹해서 내려주는 env — 암호화된 값은 "***" 로 치환돼 있다(원문 미노출). */
  env?: Record<string, string> | null;
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
    enabled: s.enabled !== false,
    autoSpawn: s.auto_spawn === true,
    isGlobal: s.visibility === "global",
    oauthConnected: s.oauthConnected === true,
    errorCode: s.connectionStatus === "connected" ? null : (s.connectionErrorCode ?? null),
    errorDetail: s.connectionStatus === "connected" ? null : (s.connectionError ?? null),
    lastChecked: relativeTime(s.lastPing, t),
    envKeys: Object.keys(s.env ?? {}),
    secretKeys: Object.entries(s.env ?? {})
      .filter(([, v]) => v === "***")
      .map(([k]) => k),
  };
}

/* ── 자격증명(env) 변경 모달 ────────────────────────────────── */
function EnvEditModal({
  server,
  onClose,
  onSuccess,
}: {
  server: McpServer | null;
  onClose: () => void;
  onSuccess: (respawnRequired: boolean) => void;
}) {
  const t = useTranslations("mcpServers");
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 서버가 바뀌면 입력값 초기화 — 이전 서버에 입력하던 값이 남아 다른 서버로
  // 전송되는 사고를 막는다.
  useEffect(() => {
    setValues({});
    setError(null);
  }, [server?.id]);

  if (!server) return null;

  // 값을 입력한 키만 전송한다(부분 갱신). 빈 칸 = 기존 값 유지.
  const filled = Object.entries(values).filter(([, v]) => v.trim().length > 0);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!server || filled.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await ApiClient.patch<ApiEnvelope<{ respawnRequired: boolean }>>(
        `/api/mcp/servers/${server.id}/env`,
        { env: Object.fromEntries(filled) },
      );
      onClose();
      onSuccess(res?.data?.respawnRequired ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("envUpdateError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-surface p-6 shadow-xl">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">{t("envEditTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-4 text-xs text-muted">{server.name}</p>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-2">
            {t("envEditHint")}
          </p>
          {server.envKeys.map((key) => {
            const isSecret = server.secretKeys.includes(key);
            return (
              <div key={key}>
                <label className="mb-1 block font-mono text-xs font-medium text-fg-2">
                  {key}
                  {isSecret && (
                    <span className="ml-2 font-sans text-[10px] text-faint">
                      {t("envSecretHint")}
                    </span>
                  )}
                </label>
                <input
                  type={isSecret ? "password" : "text"}
                  autoComplete="off"
                  value={values[key] ?? ""}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  placeholder={t("envUnchangedPlaceholder")}
                  className="h-9 w-full rounded-md border border-border-strong bg-app px-3 text-sm text-fg outline-none transition focus:border-accent"
                />
              </div>
            );
          })}
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={submitting || filled.length === 0}>
              {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
              {t("envSave")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
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

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
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

/** Draft(승인 대기) 탭은 `/approvals` 로 이관됨 — 아래 주석 참고 (2026-08-25). */
type TabId = "servers" | "instances";

export function ConnectorsSection() {
  const t = useTranslations("mcpServers");
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("servers");
  const [modalOpen, setModalOpen] = useState(false);
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [envEditTarget, setEnvEditTarget] = useState<McpServer | null>(null);
  const [envNotice, setEnvNotice] = useState<string | null>(null);
  // OAuth 콜백 착지 — 결과를 알리고 목록을 다시 읽는다(토큰이 생겨 연결됐을 수 있다)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("mcpOauth");
    if (!result) return;
    const server = params.get("server") ?? "";
    setEnvNotice(result === "ok" ? t("oauthOk", { server } as never) : t("oauthFailed", { server, reason: params.get("reason") ?? "" } as never));
    params.delete("mcpOauth"); params.delete("server"); params.delete("reason");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // env 교체 성공 — 백엔드가 기존 컨테이너를 정리했으므로(stale env 방지) 재연결 안내.
  function handleEnvUpdated(respawnRequired: boolean) {
    setEnvNotice(respawnRequired ? t("envSavedRespawn") : t("envSaved"));
    if (respawnRequired) {
      setServers((prev) =>
        prev.map((s) => (s.id === envEditTarget?.id ? { ...s, status: "disconnected" } : s)),
      );
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

  /**
   * 원격 MCP OAuth 로그인 — 백엔드가 인가 URL 을 만들어 주면 브라우저를 그리로 보낸다.
   * 콜백이 끝나면 커넥터 탭으로 돌아오며 ?mcpOauth=ok|error 로 결과를 알린다.
   */
  async function handleOAuthLogin(id: string) {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const r = await ApiClient.post<ApiEnvelope<{ authorized: boolean; authorizationUrl: string | null }>>(
        `/api/mcp/servers/${id}/oauth/start`, {});
      if (r.data?.authorizationUrl) {
        window.location.assign(r.data.authorizationUrl);
        return; // 페이지를 떠난다 — 로딩 상태는 그대로 두어 중복 클릭을 막는다
      }
      // 이미 유효한 토큰이 있어 갱신만 됐다 → 바로 연결
      await handleConnect(id);
    } catch (e) {
      alert(t("oauthStartFailed", { error: e instanceof Error ? e.message : "" } as never));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  async function handleOAuthLogout(id: string) {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await ApiClient.del(`/api/mcp/servers/${id}/oauth`);
      setServers((prev) => prev.map((s) => (s.id === id ? { ...s, oauthConnected: false, status: "disconnected", toolCount: 0 } : s)));
    } catch (e) {
      alert(t("oauthStartFailed", { error: e instanceof Error ? e.message : "" } as never));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  /**
   * 사용 여부 토글 — 끄면 목록에 남되 "사용 안 함"으로 표시되고 살아있는 연결도 정리된다.
   * 삭제와 달리 되돌릴 수 있어, 연결이 구조적으로 불가능한 서버를 치우는 데 쓴다.
   */
  async function handleToggleEnabled(id: string, next: boolean) {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await ApiClient.patch<ApiEnvelope<{ enabled: boolean }>>(
        `/api/mcp/servers/${id}/enabled`,
        { enabled: next },
      );
      setServers((prev) =>
        prev.map((s) =>
          s.id === id
            ? { ...s, enabled: next, status: next ? s.status : "disconnected", toolCount: next ? s.toolCount : 0 }
            : s,
        ),
      );
    } catch (e) {
      alert(t("toggleFailed", { error: e instanceof Error ? e.message : "" } as never));
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  /**
   * 자동 연결 토글 — 켜면 서버가 즉시 spawn 을 시도하고 `spawned` 로 결과를 알려준다
   * (handleConnect 와 같은 낙관적 갱신; 실패 원인은 다음 목록 조회의 connectionError 로 보인다).
   */
  async function handleToggleAutoSpawn(id: string, next: boolean) {
    setActionLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const res = await ApiClient.patch<ApiEnvelope<{ auto_spawn: boolean; spawned: boolean }>>(
        `/api/mcp/servers/${id}/auto-spawn`,
        { auto_spawn: next },
      );
      const spawned = res?.data?.spawned === true;
      setServers((prev) =>
        prev.map((s) => (s.id === id ? { ...s, autoSpawn: next, status: spawned ? "connected" : s.status } : s)),
      );
    } catch (e) {
      alert(t("toggleFailed", { error: e instanceof Error ? e.message : "" } as never));
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
        // 401·네트워크 실패 등 → 빈 목록 (그전엔 하드코딩 목업 5종이 실렌더됐다)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <GitImportModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          // 설치분은 draft 로 들어가며 승인해야 연결된다 — 단일 승인 창구로 보낸다
          router.push("/approvals");
        }}
      />
      <EnvEditModal
        server={envEditTarget}
        onClose={() => setEnvEditTarget(null)}
        onSuccess={handleEnvUpdated}
      />
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <p className="mt-0.5 text-xs text-muted">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 구 Draft 탭 자리 — 승인은 /approvals 한 곳으로 모았다 (2026-08-25) */}
          <Button variant="outline" size="sm" onClick={() => router.push("/approvals")}>
            <ClipboardCheck className="h-4 w-4" />
            {t("pendingApprovals")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push("/mcp-catalog")}>
            <Boxes className="h-4 w-4" />
            {t("catalog")}
          </Button>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("addServer")}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {envNotice && (
          <div className="mb-4 flex items-start justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-fg-2">
            <span>{envNotice}</span>
            <button
              type="button"
              onClick={() => setEnvNotice(null)}
              className="rounded p-0.5 text-muted hover:text-fg"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        {/* 탭 */}
        <div className="mb-4 inline-flex rounded-pill border border-border bg-surface-2 p-1">
          {(["servers", "instances"] as TabId[]).map((tabId) => (
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
              {tabId === "servers" ? t("tabServers") : t("tabInstances")}
            </button>
          ))}
        </div>

        {/* 서버 목록 탭 */}
        {tab === "servers" && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <thead>
              {/* 열 폭이 모자라면 헤더 글자가 세로로 꺾이던 것 — 줄바꿈 대신 Table 의 가로 스크롤에 맡긴다 */}
              <tr className="whitespace-nowrap">
                <Th>{t("colName")}</Th>
                <Th>{t("colType")}</Th>
                <Th className="text-right">{t("colToolCount")}</Th>
                <Th>{t("colStatus")}</Th>
                {/* 지연(latency) 열은 제거 — 백엔드가 수치를 제공하지 않아 항상 "—" 였고 폭만 차지했다 */}
                <Th>{t("colLastChecked")}</Th>
                <Th>{t("colAction")}</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <Td colSpan={6}>
                    <div className="py-12 text-center text-muted">{t("loading")}</div>
                  </Td>
                </tr>
              ) : servers.length === 0 ? (
                <tr>
                  <Td colSpan={6}>
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
                      <Td className="whitespace-nowrap">
                        <Badge tone={TRANSPORT_TONE[s.transport]}>
                          <span className="font-mono">{s.transport}</span>
                        </Badge>
                      </Td>
                      <Td className="whitespace-nowrap text-right font-mono text-fg">
                        {s.toolCount}
                      </Td>
                      <Td className="min-w-[13rem]">
                        {/* 사용 안 함이 연결 상태보다 우선 — 안 쓰기로 한 서버에 "연결 안 됨"만
                            보이면 고장난 것처럼 읽힌다. 자동 연결을 끈 채 실패한 적 없는 서버도
                            같은 이유로 "대기 중"(중립) — 시작을 안 한 것이지 끊긴 게 아니다 */}
                        {(() => {
                          const idle = s.enabled && !s.autoSpawn && !s.isGlobal
                            && s.status === "disconnected" && !s.errorCode;
                          return (
                            <Badge tone={s.enabled && !idle ? meta.tone : "neutral"}>
                              {!s.enabled ? t("disabledLabel") : idle ? t("idleLabel") : t(meta.labelKey)}
                            </Badge>
                          );
                        })()}
                        {/* 실패 원인 — 없으면 아무것도 그리지 않는다(정상 서버에 잡음 금지) */}
                        {s.enabled && s.errorCode && (
                          <div
                            className="mt-1 flex items-start gap-1 text-xs text-warn"
                            title={s.errorDetail ?? undefined}
                          >
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                            <span>{t(`connectError.${s.errorCode}`)}</span>
                            {s.errorCode === "auth_required" && (
                              <button
                                type="button"
                                disabled={isActing}
                                onClick={() => void handleOAuthLogin(s.id)}
                                className="ml-1 inline-flex items-center gap-1 whitespace-nowrap font-medium text-accent hover:underline disabled:opacity-50"
                              >
                                <LogIn className="h-3 w-3" />{t("oauthLogin")}
                              </button>
                            )}
                          </div>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-faint">{s.lastChecked}</Td>
                      <Td className="whitespace-nowrap">
                        {/* 폭이 모자라면 버튼 글자를 꺾는 대신 버튼 단위로 다음 줄에 감싼다 */}
                        <div className="flex flex-wrap items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isActing}
                            onClick={() => void handleToggleEnabled(s.id, !s.enabled)}
                            title={s.enabled ? t("disableTitle") : t("enableTitle")}
                          >
                            {s.enabled ? <PowerOff className="h-3 w-3" /> : <Power className="h-3 w-3" />}
                            {s.enabled ? t("disable") : t("enable")}
                          </Button>
                          {/* 전역 서버는 부팅 시 registry 가 띄우므로 이 축이 없다 */}
                          {!s.isGlobal && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isActing || !s.enabled}
                              onClick={() => void handleToggleAutoSpawn(s.id, !s.autoSpawn)}
                              title={s.autoSpawn ? t("autoSpawnOffTitle") : t("autoSpawnOnTitle")}
                            >
                              {s.autoSpawn ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
                              {s.autoSpawn ? t("autoSpawnOn") : t("autoSpawnOff")}
                            </Button>
                          )}
                          {s.oauthConnected && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isActing}
                              onClick={() => void handleOAuthLogout(s.id)}
                              title={t("oauthLogoutTitle")}
                            >
                              <LogOut className="h-3 w-3" />
                              {t("oauthLogout")}
                            </Button>
                          )}
                          {s.envKeys.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setEnvEditTarget(s)}
                              title={t("envEditTitle")}
                            >
                              <KeyRound className="h-3 w-3" />
                              {t("envEdit")}
                            </Button>
                          )}
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
        </div>
        )}

        {/* 인스턴스 상태 탭 — 프로세스 lifecycle(시작·중지·pid 헬스체크) */}
        {tab === "instances" && (
          <McpInstancesPanel servers={servers.map((s) => ({ id: s.id, name: s.name }))} />
        )}
      </CardContent>
    </Card>
  );
}
