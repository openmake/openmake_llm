"use client";

/**
 * 대화 공유 모달 — 공개 범위 선택 → (org 면 조직 명시 선택) → 서버 미리보기 → 확인 체크 → 게시 → 링크 복사/해제.
 *
 * 화면은 판정을 계산하지 않는다: 고를 수 있는 범위·조직은 서버가 준 capabilities 그대로, 게시 가능 여부는
 * 서버가 최종 판단한다. 범위·조직이 바뀌면 이전 미리보기와 확인을 버린다(보지 않은 내용이 게시되지 않게).
 */
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Copy, LoaderCircle } from "lucide-react";
import type {
  ConversationSharePreviewResponse,
  ConversationShareStatusResponse,
  ConversationShareVisibility,
} from "@openmake/shared-types";
import { ConversationShareApi } from "@/lib/api-client";
import { shareErrorKey, type ShareErrorKey } from "@/lib/conversation-share";
import { Button, Dialog, NativeSelect } from "@/components/ui/primitives";
import { COPY_FEEDBACK_RESET_MS } from "@/lib/constants/ui-limits";
import { ConversationShareDocumentView } from "./conversation-share-document";

type Busy = null | "preview" | "publish" | "revoke";

export function ConversationShareModal({ sessionId, onCloseAction }: { sessionId: string; onCloseAction: () => void }) {
  const t = useTranslations("conversationShare");
  const format = useFormatter();
  const [status, setStatus] = useState<ConversationShareStatusResponse | null>(null);
  const [loadError, setLoadError] = useState<ShareErrorKey | null>(null);
  const [visibility, setVisibility] = useState<ConversationShareVisibility>("private");
  const [orgId, setOrgId] = useState("");
  const [preview, setPreview] = useState<ConversationSharePreviewResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ShareErrorKey | null>(null);
  const [notice, setNotice] = useState<"published" | "revoked" | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ConversationShareApi.status(sessionId)
      .then((res) => {
        if (cancelled) return;
        setStatus(res.data);
        const share = res.data.share;
        if (share && res.data.capabilities.allowedVisibilities.includes(share.visibility)) {
          setVisibility(share.visibility);
          setOrgId(share.orgId ?? "");
        }
      })
      .catch((e) => { if (!cancelled) setLoadError(shareErrorKey(e)); });
    return () => { cancelled = true; };
  }, [sessionId]);

  const resetPreview = () => { setPreview(null); setConfirmed(false); };
  const changeScope = (v: ConversationShareVisibility) => { setVisibility(v); setOrgId(""); resetPreview(); setError(null); setNotice(null); };
  const changeOrg = (id: string) => { setOrgId(id); resetPreview(); setError(null); };

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      const key = shareErrorKey(e);
      setError(key);
      if (key === "stale") resetPreview();
    } finally {
      setBusy(null);
    }
  };

  const makePreview = () => run("preview", async () => {
    resetPreview();
    const body = visibility === "org" ? { visibility, orgId } : { visibility };
    const res = await ConversationShareApi.preview(sessionId, body);
    setPreview(res.data);
  });

  const publish = () => run("publish", async () => {
    if (!preview || !confirmed) return;
    const res = await ConversationShareApi.publish(sessionId, preview.previewId);
    setStatus((s) => (s ? { ...s, share: res.data } : s));
    resetPreview();
    setNotice("published");
  });

  const revoke = () => run("revoke", async () => {
    await ConversationShareApi.revoke(sessionId);
    setStatus((s) => (s ? { ...s, share: null } : s));
    resetPreview();
    setNotice("revoked");
  });

  const copy = async () => {
    if (!status?.share) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${status.share.path}`);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_RESET_MS);
    } catch {
      setError("generic");
    }
  };

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  };

  const share = status?.share ?? null;
  const caps = status?.capabilities;
  const canPreview = !busy && !!caps && (visibility !== "org" || orgId !== "");

  return (
    <Dialog open onClose={onCloseAction} title={t("title")} className="max-h-[90dvh] max-w-2xl overflow-y-auto">
      {loadError ? (
        <p role="alert" className="text-sm text-fg-2">{t("unavailable")}</p>
      ) : !caps ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />{t("loading")}</p>
      ) : (
        <div className="space-y-4">
          {share && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-2">
              <span className="min-w-0 flex-1">{t("current", { scope: t(`scope.${share.visibility}`), date: when(share.capturedAt) })}</span>
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("copied") : t("copyLink")}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={revoke}>{t("revoke")}</Button>
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-muted">{t("scopeLabel")}</legend>
            {caps.allowedVisibilities.map((v) => (
              <label key={v} className="flex cursor-pointer items-start gap-2 text-sm text-fg">
                <input type="radio" name="conversation-share-scope" value={v} checked={visibility === v} onChange={() => changeScope(v)} className="mt-1" />
                <span>
                  <span className="font-medium">{t(`scope.${v}`)}</span>
                  <span className="block text-xs text-faint">{t(`scopeHint.${v}`)}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {visibility === "org" && (
            <label className="block space-y-1 text-xs font-medium text-muted">
              <span>{t("orgLabel")}</span>
              <NativeSelect value={orgId} onChange={(e) => changeOrg(e.target.value)}>
                <option value="">{t("orgPlaceholder")}</option>
                {caps.organizations.map((o) => <option key={o.orgId} value={o.orgId}>{o.name}</option>)}
              </NativeSelect>
            </label>
          )}

          <Button type="button" variant="outline" disabled={!canPreview} onClick={makePreview}>
            {busy === "preview" ? t("previewing") : t("preview")}
          </Button>

          {preview && (
            <div className="space-y-3">
              <p className="text-xs text-fg-2">{t("previewNote")}</p>
              <p className="text-xs text-faint">{t("limitsNote")}</p>
              <ConversationShareDocumentView document={preview.document} className="max-h-80 overflow-y-auto rounded-md border border-border p-3" />
              <label className="flex items-start gap-2 text-sm text-fg">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
                <span>{t("confirm")}</span>
              </label>
            </div>
          )}

          {error && <p role="alert" className="text-sm text-danger">{t(`error.${error}`)}</p>}
          {notice && <p role="status" className="text-sm text-fg-2">{t(notice)}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCloseAction}>{t("close")}</Button>
            <Button type="button" disabled={!preview || !confirmed || !!busy} onClick={publish}>
              {busy === "publish" ? t("publishing") : share ? t("republish") : t("publish")}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
