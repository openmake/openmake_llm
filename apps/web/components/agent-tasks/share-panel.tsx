"use client";

/**
 * 작업 공유 패널 (작업 상세 모달 안).
 *
 * 안전의 축은 **미리보기 → 명시 확인 → 게시**다. 자동 정화(redact)는 보조일 뿐이라
 * 사용자가 "공개될 내용 그대로"를 본 뒤에만 게시 버튼이 열린다. 범위 토글을 바꾸면
 * 미리보기가 무효가 되고 다시 확인해야 한다 — 확인한 것과 다른 것이 나가지 않도록.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy, Eye, Link2, LoaderCircle, Share2, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import {
  getShareState, previewShare, publishShare, unshareTask,
  type ShareDocument, type ShareState, type ShareVisibility,
} from "@/lib/share-task";

export function SharePanel({ taskId }: { taskId: string }) {
  const t = useTranslations("agentTasks.share");
  const [open, setOpen] = useState(false);
  const [share, setShare] = useState<ShareState | null>(null);
  const [preview, setPreview] = useState<ShareDocument | null>(null);
  const [includeSteps, setIncludeSteps] = useState(true);
  const [includeDiff, setIncludeDiff] = useState(true);
  const [visibility, setVisibility] = useState<ShareVisibility>("authenticated");
  const [busy, setBusy] = useState<"load" | "preview" | "publish" | "unshare" | null>("load");
  const [republish, setRepublish] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getShareState(taskId)
      .then((res) => {
        if (cancelled) return;
        const s = res?.data?.share ?? null;
        setShare(s);
        if (s) {
          setVisibility(s.visibility);
          setIncludeSteps(s.includeSteps);
          setIncludeDiff(s.includeDiff);
        }
      })
      .catch(() => { /* 미공유로 취급 */ })
      .finally(() => { if (!cancelled) setBusy(null); });
    return () => { cancelled = true; };
  }, [taskId]);

  // 범위가 바뀌면 이전 미리보기는 무효 — 확인한 내용과 게시 내용이 어긋나지 않게.
  const invalidate = useCallback(() => setPreview(null), []);

  const run = async (kind: "preview" | "publish" | "unshare") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "preview") {
        const res = await previewShare(taskId, { includeSteps, includeDiff });
        setPreview(res?.data?.preview ?? null);
      } else if (kind === "publish") {
        const res = await publishShare(taskId, { visibility, includeSteps, includeDiff });
        setShare(res?.data ?? null);
        setPreview(null);
        setRepublish(false);
      } else {
        await unshareTask(taskId);
        setShare(null);
        setPreview(null);
        setRepublish(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "error");
    } finally {
      setBusy(null);
    }
  };

  const shareUrl = share ? `${typeof window !== "undefined" ? window.location.origin : ""}${share.path}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* 클립보드 거부 — URL 은 화면에 그대로 보인다 */ }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-md border border-border bg-surface-1 px-3 py-2 text-left text-xs text-fg-2 hover:bg-surface-2"
      >
        <span className="flex items-center gap-2">
          <Share2 className="h-3.5 w-3.5" />
          {t("title")}
        </span>
        {share ? <Badge tone="success">{t("sharing")}</Badge> : <span className="text-faint">{t("notShared")}</span>}
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-border bg-surface-1 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-medium text-fg-2">
          <Share2 className="h-3.5 w-3.5" />
          {t("title")}
        </p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-faint hover:text-fg-2">
          {t("close")}
        </button>
      </div>

      {share && !republish ? (
        <div className="space-y-2">
          <p className="text-xs text-muted">{t(share.visibility === "link" ? "scopeLink" : "scopeAuthenticated")}</p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-xs text-fg-2"
            />
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setRepublish(true); void run("preview"); }}>
              {t("republish")}
            </Button>
            <Button size="sm" variant="danger" disabled={busy === "unshare"} onClick={() => void run("unshare")}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t("unshare")}
            </Button>
          </div>
          <p className="text-[11px] text-faint">{t("unshareHint")}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* 범위 — 기본은 넓게 잡되(진행 기록·변경분 포함) 언제든 줄일 수 있다. */}
          <div className="flex flex-wrap gap-3 text-xs text-fg-2">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={includeSteps} onChange={(e) => { setIncludeSteps(e.target.checked); invalidate(); }} />
              {t("includeSteps")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={includeDiff} onChange={(e) => { setIncludeDiff(e.target.checked); invalidate(); }} />
              {t("includeDiff")}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
            {(["authenticated", "link"] as ShareVisibility[]).map((v) => (
              <label key={v} className="flex items-center gap-1.5">
                <input type="radio" name="share-visibility" checked={visibility === v} onChange={() => setVisibility(v)} />
                {t(v === "link" ? "scopeLink" : "scopeAuthenticated")}
              </label>
            ))}
          </div>

          <Button size="sm" variant="outline" disabled={busy === "preview"} onClick={() => void run("preview")}>
            {busy === "preview" ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1 h-3.5 w-3.5" />}
            {t("previewBtn")}
          </Button>

          {preview && (
            <div className="space-y-2 rounded border border-border-strong bg-surface p-2">
              <p className="text-[11px] font-medium text-warning">{t("previewNotice")}</p>
              <div className="max-h-56 space-y-1.5 overflow-y-auto text-[11px]">
                <p className="whitespace-pre-wrap text-fg-2"><span className="text-faint">{t("goalLabel")} </span>{preview.goal || "—"}</p>
                {preview.result && (
                  <p className="whitespace-pre-wrap text-fg-2"><span className="text-faint">{t("resultLabel")} </span>{preview.result}</p>
                )}
                {preview.steps.map((s) => (
                  <p key={s.n} className="truncate font-mono text-muted">
                    <span className="text-faint">{s.n}</span> {s.tool ?? s.type}: {s.text}
                  </p>
                ))}
                {preview.diffs.length > 0 && <p className="text-muted">{t("diffIncluded", { n: preview.diffs.length })}</p>}
              </div>
              <Button size="sm" disabled={busy === "publish"} onClick={() => void run("publish")}>
                {busy === "publish" ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1 h-3.5 w-3.5" />}
                {t(visibility === "link" ? "publishLink" : "publishAuthenticated")}
              </Button>
            </div>
          )}
          {!preview && <p className="text-[11px] text-faint">{t("previewFirst")}</p>}
          {republish && (
            <button type="button" onClick={() => { setRepublish(false); setPreview(null); }} className="text-[11px] text-faint underline">
              {t("republishCancel")}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
