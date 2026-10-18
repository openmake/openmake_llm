"use client";

/**
 * 원격 MCP 사전 등록 OAuth 클라이언트 설정 (155, 계획 R-3) — 동적 등록을 받지 않는 인가 서버(GitHub·Google)용.
 * 백엔드 `/api/admin/mcp/catalog/:id/oauth-client`. secret 은 write-only(비워 두면 기존 값 유지),
 * 콜백 URL 은 provider 콘솔(GitHub OAuth App·Google OAuth 클라이언트)에 등록할 값이라 복사할 수 있게 보여 준다.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, X } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Button, useFocusTrap } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";

type AuthMethod = "" | "client_secret_post" | "client_secret_basic" | "none";

interface OAuthClientView {
  clientId: string;
  hasSecret: boolean;
  tokenEndpointAuthMethod?: Exclude<AuthMethod, "">;
  scope?: string;
  authorizationParams: Record<string, string>;
}

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-fg-2";

/** "key=value" 줄 목록 ↔ 객체 — 빈 줄·등호 없는 줄은 버린다(키 형식 검증은 서버) */
export function parseAuthorizationParams(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function McpOAuthClientModal({ catalogId, name, onClose }: { catalogId: string; name: string; onClose: () => void }) {
  const t = useTranslations("adminMcpCatalog.oauthClient");
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);
  const base = `/api/admin/mcp/catalog/${encodeURIComponent(catalogId)}/oauth-client`;
  const [loading, setLoading] = useState(true);
  const [redirectUri, setRedirectUri] = useState("");
  const [existing, setExisting] = useState<OAuthClientView | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [removeSecret, setRemoveSecret] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("");
  const [scope, setScope] = useState("");
  const [params, setParams] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    ApiClient.get<ApiSuccess<{ client: OAuthClientView | null; redirectUri: string }>>(base)
      .then((r) => {
        if (!alive) return;
        const c = r.data.client;
        setRedirectUri(r.data.redirectUri);
        setExisting(c);
        if (c) {
          setClientId(c.clientId);
          setAuthMethod(c.tokenEndpointAuthMethod ?? "");
          setScope(c.scope ?? "");
          setParams(Object.entries(c.authorizationParams).map(([k, v]) => `${k}=${v}`).join("\n"));
        }
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : t("loadError")))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [base, t]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const r = await ApiClient.put<ApiSuccess<{ client: OAuthClientView }>>(base, {
        clientId: clientId.trim(),
        // 비워 두면 기존 secret 유지, 제거 체크 시 null
        ...(removeSecret ? { clientSecret: null } : clientSecret ? { clientSecret } : {}),
        tokenEndpointAuthMethod: authMethod || null,
        scope: scope.trim() || null,
        authorizationParams: parseAuthorizationParams(params),
      });
      setExisting(r.data.client);
      setClientSecret("");
      setRemoveSecret(false);
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("saveError"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await ApiClient.del(base);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("saveError"));
      setBusy(false);
    }
  }

  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(ev) => { if (ev.currentTarget === ev.target) onClose(); }}>
      <div ref={trapRef} role="dialog" aria-modal="true" aria-label={t("title", { name })} tabIndex={-1}
        className="relative mx-4 max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-surface p-6 shadow-xl outline-none"
        onClick={(ev) => ev.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 text-faint hover:text-fg" aria-label={t("close")}>
          <X className="h-4 w-4" />
        </button>
        <h2 className="mb-1 text-base font-semibold text-fg">{t("title", { name })}</h2>
        <p className="mb-4 text-xs text-muted">{t("description")}</p>
        {loading ? (
          <div className="grid place-items-center py-8"><Loader2 className="h-5 w-5 animate-spin text-faint" /></div>
        ) : (
          <div className="space-y-3">
            <div>
              <span className={labelCls}>{t("redirectUri")}</span>
              <input readOnly value={redirectUri} className={`${inputCls} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <label className="block">
              <span className={labelCls}>{t("clientId")}</span>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls} autoComplete="off" />
            </label>
            <label className="block">
              <span className={labelCls}>{t("clientSecret")}</span>
              <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} disabled={removeSecret}
                placeholder={existing?.hasSecret ? t("secretKeep") : ""} className={inputCls} autoComplete="new-password" />
            </label>
            {existing?.hasSecret && (
              <label className="flex items-center gap-2 text-xs text-fg-2">
                <input type="checkbox" checked={removeSecret} onChange={(e) => setRemoveSecret(e.target.checked)} />
                {t("secretRemove")}
              </label>
            )}
            <label className="block">
              <span className={labelCls}>{t("authMethod")}</span>
              <select value={authMethod} onChange={(e) => setAuthMethod(e.target.value as AuthMethod)} className={inputCls}>
                <option value="">{t("authMethodAuto")}</option>
                <option value="client_secret_post">client_secret_post</option>
                <option value="client_secret_basic">client_secret_basic</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>{t("scope")}</span>
              <input value={scope} onChange={(e) => setScope(e.target.value)} className={`${inputCls} font-mono text-xs`} />
              <span className="mt-1 block text-[11px] text-muted">{t("scopeHint")}</span>
            </label>
            <label className="block">
              <span className={labelCls}>{t("authorizationParams")}</span>
              <textarea value={params} onChange={(e) => setParams(e.target.value)} rows={3}
                placeholder={"access_type=offline\nprompt=consent"}
                className="w-full resize-none rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none" />
            </label>
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            {saved && <p className="text-xs text-success" role="status">{t("saved")}</p>}
            <div className="flex justify-between gap-2 pt-2">
              {existing ? (
                <Button variant="danger" size="sm" onClick={() => void remove()} disabled={busy}>{t("remove")}</Button>
              ) : <span />}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>{t("close")}</Button>
                <Button size="sm" onClick={() => void save()} disabled={busy || !clientId.trim()}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("save")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
