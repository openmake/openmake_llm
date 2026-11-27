"use client";

/**
 * 카탈로그 원본 관리 패널(관리자, 마켓플레이스 M4) — 동기화 상태 표시 · 원본 토큰 저장/삭제(write-only) · 하위 경로
 * · 정적 색인 주소(M6, index.json — 켜짐은 서버 EXTENSION_CATALOG_INDEX_ENABLED). 색인 폴백 경고는 성공(ok)이어도 보인다.
 *
 * 토큰은 입력란에서 보내기만 한다 — 서버는 저장 여부(has_credential)만 돌려주고 값은 다시 내려오지 않는다.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { KeyRound, Loader2 } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

interface AdminCatalogSource {
  id: string;
  has_credential?: boolean;
  source_subpath?: string | null;
  index_url?: string | null;
  sync_status?: "ok" | "error" | "rate_limited" | null;
  last_sync_error?: string | null;
  last_sync_attempt_at?: string | null;
}

const STATUS_KEY: Record<string, string> = {
  ok: "statusOk",
  error: "statusError",
  rate_limited: "statusRateLimited",
};
const STATUS_CLS: Record<string, string> = {
  ok: "text-success",
  error: "text-danger",
  rate_limited: "text-warn",
};

export function CatalogSourceAdmin({ sourceId, refreshKey }: { sourceId: string; refreshKey: number }) {
  const t = useTranslations("extensions.catalog.admin");
  const locale = useLocale();
  const [source, setSource] = useState<AdminCatalogSource | null>(null);
  const [token, setToken] = useState("");
  const [subpath, setSubpath] = useState("");
  const [indexUrl, setIndexUrl] = useState("");
  const [busy, setBusy] = useState<"token" | "clear" | "subpath" | "index" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApiSuccess<{ sources: AdminCatalogSource[] }>>(
        "/api/users/me/extensions/catalog/admin",
      );
      const found = res?.data?.sources?.find((s) => s.id === sourceId) ?? null;
      setSource(found);
      setSubpath(found?.source_subpath ?? "");
      setIndexUrl(found?.index_url ?? "");
    } catch {
      setSource(null);
    }
  }, [sourceId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function saveToken(value: string | null) {
    setBusy(value ? "token" : "clear");
    setNote(null);
    try {
      await ApiClient.put(`/api/users/me/extensions/catalog/${sourceId}/credential`, { token: value });
      setToken("");
      setNote(t("saved"));
      void load();
    } catch {
      setNote(t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function patchSource(kind: "subpath" | "index", body: Record<string, string | null>) {
    setBusy(kind);
    setNote(null);
    try {
      await ApiClient.patch(`/api/users/me/extensions/catalog/${sourceId}`, body);
      setNote(t("saved"));
      void load();
    } catch {
      setNote(t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  if (!source) return null;
  const status = source.sync_status ?? null;
  const attempted = source.last_sync_attempt_at
    ? new Date(source.last_sync_attempt_at).toLocaleString(locale)
    : null;

  return (
    <div className="space-y-2 border-b border-border px-3.5 py-2 text-xs">
      <p className={status ? STATUS_CLS[status] : "text-muted"}>
        {t(status ? STATUS_KEY[status] : "statusNever")}
        {attempted && <span className="ml-1.5 text-muted">{t("lastAttempt", { time: attempted })}</span>}
      </p>
      {status && source.last_sync_error && (
        <p className={`break-all font-mono ${status === "ok" ? "text-warn" : "text-muted"}`}>
          {status === "ok" && <span className="mr-1 font-sans">{t("indexFallbackWarning")}</span>}
          {source.last_sync_error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <KeyRound className="h-3.5 w-3.5 text-muted" aria-hidden />
        <span className="text-muted">{source.has_credential ? t("credentialSaved") : t("credentialNone")}</span>
        <Input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={t("tokenPlaceholder")}
          aria-label={t("tokenPlaceholder")}
          className="h-8 min-w-0 flex-1 text-xs sm:max-w-[280px]"
        />
        <Button size="sm" variant="ghost" disabled={!token.trim() || busy !== null} onClick={() => void saveToken(token.trim())}>
          {busy === "token" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("saveToken")}
        </Button>
        {source.has_credential && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm(t("clearTokenConfirm"))) void saveToken(null);
            }}
          >
            {busy === "clear" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("clearToken")}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={subpath}
          onChange={(e) => setSubpath(e.target.value)}
          placeholder={t("subpathPlaceholder")}
          aria-label={t("subpathPlaceholder")}
          className="h-8 min-w-0 flex-1 font-mono text-xs sm:max-w-[280px]"
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null || (subpath.trim() || null) === (source.source_subpath ?? null)}
          onClick={() => void patchSource("subpath", { sourceSubpath: subpath.trim() || null })}
        >
          {busy === "subpath" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("saveSubpath")}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="url"
          value={indexUrl}
          onChange={(e) => setIndexUrl(e.target.value)}
          placeholder={t("indexUrlPlaceholder")}
          aria-label={t("indexUrlPlaceholder")}
          className="h-8 min-w-0 flex-1 font-mono text-xs sm:max-w-[280px]"
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy !== null || (indexUrl.trim() || null) === (source.index_url ?? null)}
          onClick={() => void patchSource("index", { indexUrl: indexUrl.trim() || null })}
        >
          {busy === "index" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("saveIndexUrl")}
        </Button>
        <span className="text-muted">{note ?? t("syncHint")}</span>
      </div>
    </div>
  );
}
