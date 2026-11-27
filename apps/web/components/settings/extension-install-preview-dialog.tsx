"use client";

/**
 * 확장 설치 미리보기 대화상자(M1b) — 갤러리 카탈로그 설치·이름 설치 전에 설치될 구성요소·권한·원본·커밋·경고를 보인다.
 * 조회는 쓰기·LLM 이 없는 미리보기 API(`previewRequest` — 카탈로그 `/catalog/:id/preview`, 이름 `/preview-by-name`),
 * 확인하면 종전 설치를 부른다(onConfirm 에 대상을 그대로 돌려준다).
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Button, Dialog } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";
import {
  installableCounts,
  previewHintKey,
  previewRequest,
  splitWarning,
  type ExtensionInstallPreview,
  type InstallPreviewTarget,
} from "@/lib/extension-install-preview";

export function ExtensionInstallPreviewDialog({
  target,
  onClose,
  onConfirm,
}: {
  /** 미리볼 대상(카탈로그 항목·이름 설치) — null 이면 닫힘 */
  target: InstallPreviewTarget | null;
  onClose: () => void;
  onConfirm: (target: InstallPreviewTarget) => void;
}) {
  const t = useTranslations("extensions.preview");
  const [preview, setPreview] = useState<ExtensionInstallPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setPreview(null);
    setError(null);
    setLoading(true);
    const req = previewRequest(target);
    ApiClient.post<ApiSuccess<ExtensionInstallPreview>>(req.path, req.body)
      .then((res) => { if (!cancelled) setPreview(res?.data ?? null); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof ApiError && e.message ? e.message : t("failed")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [target, t]);

  const counts = preview ? installableCounts(preview) : null;
  const blocked = !!preview?.existingInstall && !preview.existingInstall.sameSource;

  return (
    <Dialog open={!!target} onClose={onClose} title={t("title", { name: target?.label ?? "" })} className="max-w-lg">
      <div className="max-h-[60vh] space-y-3 overflow-y-auto text-xs text-fg-2">
        {loading && (
          <p className="flex items-center gap-2 text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("loading")}</p>
        )}
        {error && <p className="text-danger">{error}</p>}
        {preview && counts && (
          <>
            <section>
              <p className="font-medium text-fg">{preview.extension.name} <span className="text-muted">v{preview.extension.version}</span></p>
              {preview.extension.description && <p className="mt-0.5">{preview.extension.description}</p>}
              <p className="mt-1 break-all font-mono text-[11px] text-muted">
                {t("source")}: {preview.source.url} · {t("commit")}: {preview.commit.slice(0, 12)}
              </p>
              {preview.existingInstall && (
                <p className={preview.existingInstall.sameSource ? "mt-1" : "mt-1 text-danger"}>
                  {preview.existingInstall.sameSource
                    ? (preview.existingInstall.upToDate ? t("existingUpToDate") : t("existingUpdate", { version: preview.existingInstall.version }))
                    : t("existingOtherSource")}
                </p>
              )}
            </section>

            <section>
              <p className="font-medium text-fg">{t("components", counts)}</p>
              <ul className="mt-1 space-y-1">
                {preview.components.skills.map((s) => (
                  <li key={`s:${s.path}`}>
                    <span className="text-fg">{s.fromCommand ? t("command") : t("skill")}</span> {s.name ?? s.path}
                    {s.assets && s.assets.length > 0 && <span className="text-muted"> · {t("assets", { count: s.assets.length })}</span>}
                    {s.error && <span className="text-danger"> — {s.error}</span>}
                  </li>
                ))}
                {preview.components.mcpServers.map((m) => (
                  <li key={`m:${m.name}`}>
                    <span className="text-fg">{t("mcp")}</span> {m.name} <span className="text-muted">({m.transportType})</span>
                    {m.blockedByConvention && <span className="text-danger"> — {t("mcpBlocked")}</span>}
                    {m.networkRestricted && <span className="text-muted"> · {t("networkRestricted")}</span>}
                    {m.requiredEnv.length > 0 && <span className="text-muted"> · {t("requiredEnv", { keys: m.requiredEnv.join(", ") })}</span>}
                    {m.excluded && <span className="text-danger"> — {m.excluded}</span>}
                    {m.hints.map((h) => {
                      const key = previewHintKey(h.code);
                      return key ? (
                        <p key={h.code} className="ml-3 text-warn">
                          {t(`hint.${key}`, { date: String(h.detail?.sunsetDate ?? "-"), url: String(h.detail?.replacementUrl ?? "-") })}
                        </p>
                      ) : null;
                    })}
                  </li>
                ))}
                {preview.components.agents.map((a) => (
                  <li key={`a:${a.path}`}>
                    <span className="text-fg">{t("agent")}</span> {a.plannedName}
                    {a.requiresApproval && <span className="text-muted"> · {t("agentApproval")}</span>}
                    {a.error && <span className="text-danger"> — {a.error}</span>}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-muted">{t("draftNote")}</p>
            </section>

            <section>
              <p className="font-medium text-fg">{t("permissions")}</p>
              <p>{preview.permissions.requested === null ? t("permissionsLegacy") : (preview.permissions.requested.join(", ") || t("permissionsNone"))}</p>
              {preview.permissions.blocked.length > 0 && (
                <p className="text-danger">{t("permissionsBlocked", { list: preview.permissions.blocked.join(", ") })}</p>
              )}
            </section>

            {preview.warnings.length > 0 && (
              <section>
                <p className="flex items-center gap-1 font-medium text-fg"><AlertTriangle className="h-3.5 w-3.5 text-warn" /> {t("warnings")}</p>
                <ul className="mt-1 space-y-0.5">
                  {preview.warnings.map((w, i) => {
                    const { code, text } = splitWarning(w);
                    return <li key={i} className="break-words">{code && <span className="font-mono text-fg">{code}</span>} {text}</li>;
                  })}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t("cancel")}</Button>
        <Button
          disabled={!preview || blocked}
          onClick={() => { if (target) onConfirm(target); onClose(); }}
        >
          {t("confirm")}
        </Button>
      </div>
    </Dialog>
  );
}
