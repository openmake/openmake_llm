"use client";

/**
 * MCP 서버 승인 대기 목록.
 *
 * 원래 설정 → 커넥터 → Draft 탭에만 있었다. 스킬 승인(/skill-library)과 위치가 달라
 * 사용자가 "어디서 승인하는지 모르겠다"고 하던 문제가 있어, 승인 창구를 `/approvals`
 * 한 곳으로 모으면서 이 컴포넌트로 분리했다.
 *
 * ⚠️ 위험 표시(conventionFindings 의 error)는 **정적 룰**만 근거로 한다 — LLM audit 은
 * warn 으로 강등돼 차단하지 않는다(2026-08-24, 오탐으로 정상 플러그인을 막던 문제).
 *
 * ⚠️ env 자리표시자 입력(2026-08-28): 외부 플러그인은 `"LAW_OC": "${user_config.api_key}"`
 * 처럼 값을 비워 두고 자리표시자만 적는다. 이 화면이 실제 값을 받지 않으면 서버는 뜨지만
 * 인증이 전부 실패한다 — 오류도 경고도 없이 도구만 안 되는 조용한 실패라, 그전까지
 * 빈 body 로 승인하던 것을 `requiredEnv` 기반 입력 폼으로 바꿨다. 백엔드는 같은 목록으로
 * 422(REQUIRED_ENV_MISSING)를 던지므로 UI 를 건너뛴 승인도 막힌다.
 *
 * @see app/(workspace)/approvals/page.tsx
 * @see apps/api/src/mcp/env-placeholder.ts
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, X, Loader2, Server, AlertTriangle, KeyRound } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";

interface EnvHint {
  key: string;
  title?: string;
  description?: string;
  sensitive?: boolean;
}

interface DraftServer {
  id: string;
  name?: string;
  git_url?: string;
  status: string;
  manifest_meta?: {
    conventionFindings?: { severity: string; rule?: string; message?: string; source?: string }[];
    extensionName?: string;
    /** 값이 자리표시자라 승인 시 실제 값을 받아야 하는 env 키 */
    requiredEnv?: string[];
    /** 입력 라벨·발급 안내 (plugin.json userConfig 유래) */
    envHints?: EnvHint[];
  };
}

export function McpDrafts({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("approvals");
  const [drafts, setDrafts] = useState<DraftServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<Record<string, boolean>>({});
  const [envInputs, setEnvInputs] = useState<Record<string, Record<string, string>>>({});
  const [envErrors, setEnvErrors] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<{ data: DraftServer[] }>("/api/mcp/servers/drafts");
      setDrafts(res?.data ?? []);
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function setEnvValue(draftId: string, key: string, value: string) {
    setEnvInputs((prev) => ({ ...prev, [draftId]: { ...(prev[draftId] ?? {}), [key]: value } }));
  }

  async function act(id: string, action: "approve" | "reject") {
    setActing((p) => ({ ...p, [id]: true }));
    setEnvErrors((p) => ({ ...p, [id]: [] }));
    try {
      // 승인만 env 를 싣는다 — 거부는 값이 필요 없다.
      const body = action === "approve" ? { envOverrides: envInputs[id] ?? {} } : {};
      await ApiClient.post(`/api/mcp/servers/${id}/${action}`, body);
      await load();
      onRefreshAction?.();
    } catch (err) {
      // 백엔드가 비어 있는 키를 알려준다 — 폼에 그대로 표시해 무엇을 채워야 하는지 남긴다
      const missing =
        err instanceof ApiError && (err.body as { error?: string; missing?: string[] } | undefined)?.error === "REQUIRED_ENV_MISSING"
          ? ((err.body as { missing?: string[] }).missing ?? [])
          : [];
      if (missing.length > 0) {
        setEnvErrors((p) => ({ ...p, [id]: missing }));
      } else {
        alert(t("mcp.actionFailed", { error: err instanceof Error ? err.message : "" }));
      }
    } finally {
      setActing((p) => ({ ...p, [id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (drafts.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{t("mcp.empty")}</p>;
  }

  return (
    <div className="space-y-2">
      {drafts.map((d) => {
        // 정적 룰의 error 만 실제 차단 사유다 (LLM findings 는 warn 강등)
        const risky = d.manifest_meta?.conventionFindings?.some(
          (f) => f.severity === "error" && f.source !== "llm",
        );
        const busy = acting[d.id] ?? false;
        const requiredEnv = d.manifest_meta?.requiredEnv ?? [];
        const hints = d.manifest_meta?.envHints ?? [];
        const missing = envErrors[d.id] ?? [];
        return (
          <Card key={d.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone="warn">{t("mcp.badge")}</Badge>
                  {d.manifest_meta?.extensionName && (
                    <Badge tone="neutral">{d.manifest_meta.extensionName}</Badge>
                  )}
                  {risky && (
                    <span className="inline-flex items-center gap-1 text-xs text-danger">
                      <AlertTriangle className="h-3.5 w-3.5" />{t("mcp.risk")}
                    </span>
                  )}
                </div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <Server className="h-3.5 w-3.5 text-accent" />
                  {d.name ?? d.id.slice(0, 8)}
                </h3>
                {d.git_url && (
                  <p className="mt-1 truncate font-mono text-xs text-muted">{d.git_url}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" disabled={busy} onClick={() => void act(d.id, "approve")}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("approve")}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(d.id, "reject")}>
                  <X className="h-3.5 w-3.5" />{t("reject")}
                </Button>
              </div>
            </div>

            {requiredEnv.length > 0 && (
              <div className="mt-3 space-y-2 rounded-md border border-border bg-surface-2 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
                  <KeyRound className="h-3.5 w-3.5 text-accent" />
                  {t("mcp.envRequired")}
                </p>
                {requiredEnv.map((key) => {
                  const hint = hints.find((h) => h.key === key);
                  const isMissing = missing.includes(key);
                  return (
                    <div key={key} className="space-y-1">
                      <label htmlFor={`${d.id}-${key}`} className="block text-xs text-muted">
                        <span className="font-mono text-fg">{key}</span>
                        {hint?.title && <span className="ml-1.5">{hint.title}</span>}
                      </label>
                      <input
                        id={`${d.id}-${key}`}
                        type={hint?.sensitive ? "password" : "text"}
                        autoComplete="off"
                        disabled={busy}
                        value={envInputs[d.id]?.[key] ?? ""}
                        onChange={(e) => setEnvValue(d.id, key, e.target.value)}
                        placeholder={t("mcp.envPlaceholder")}
                        className={`w-full rounded border bg-surface px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent ${
                          isMissing ? "border-danger" : "border-border"
                        }`}
                      />
                      {hint?.description && (
                        <p className="text-xs text-muted">{hint.description}</p>
                      )}
                    </div>
                  );
                })}
                {missing.length > 0 && (
                  <p className="text-xs text-danger">{t("mcp.envMissing", { keys: missing.join(", ") })}</p>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
