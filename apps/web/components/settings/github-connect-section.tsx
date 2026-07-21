"use client";

/**
 * GitHub 연결 섹션 — 사용자가 Personal Access Token(PAT)을 저장/해제한다.
 * Phase 2 Git 통합에서 에이전트 작업의 호스트측 clone/push/PR 인증에 사용된다.
 * 저장은 기존 external_connections(serviceType='github', 암호화) 를 재사용.
 * ⚠️ 토큰 원문은 응답에 노출되지 않으며(hasAccessToken 만), 격리 컨테이너에도 주입되지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GitBranch, Check, LoaderCircle } from "lucide-react";
import { ApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Status = "loading" | "connected" | "disconnected";

export function GithubConnectSection() {
  const t = useTranslations("githubConnect");
  const [status, setStatus] = useState<Status>("loading");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ApiClient.get<{ data?: { hasAccessToken?: boolean } }>("/api/external/github");
      setStatus(res?.data?.hasAccessToken ? "connected" : "disconnected");
    } catch {
      // 404 = 미연결 (그 외 오류도 미연결로 간주 — 저장 시도는 여전히 가능).
      setStatus("disconnected");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    const token = pat.trim();
    if (!token || busy) return;
    setBusy(true); setError(null);
    try {
      await ApiClient.post("/api/external", { serviceType: "github", accessToken: token });
      setPat("");
      setStatus("connected");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy || !window.confirm(t("disconnectConfirm"))) return;
    setBusy(true); setError(null);
    try {
      await ApiClient.del("/api/external/github");
      setStatus("disconnected");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("disconnectFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="mb-1 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-fg-2" />
        <h3 className="text-sm font-semibold text-fg">{t("title")}</h3>
        {status === "connected" && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
            <Check className="h-3 w-3" /> {t("connected")}
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-muted">{t("description")}</p>

      {status === "loading" ? (
        <LoaderCircle className="h-4 w-4 animate-spin text-muted" />
      ) : status === "connected" ? (
        <button
          type="button" disabled={busy} onClick={disconnect}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
        >
          {t("disconnect")}
        </button>
      ) : (
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-[11px] text-muted">{t("patLabel")}</label>
            <input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="ghp_..."
              disabled={busy}
              className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-fg-1 disabled:opacity-50"
            />
          </div>
          <button
            type="button" disabled={busy || !pat.trim()} onClick={save}
            className={cn(
              "shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50",
            )}
          >
            {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : t("save")}
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      <p className="mt-2 text-[11px] text-faint">{t("hint")}</p>
    </div>
  );
}
