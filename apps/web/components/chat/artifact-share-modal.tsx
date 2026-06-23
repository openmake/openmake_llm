"use client";

import { useState } from "react";
import { X, Globe, Lock, Link2, Check, Copy, Loader2 } from "lucide-react";
import { ApiClient, ApiError } from "@/lib/api-client";
import type { ApiSuccess } from "@openmake/shared-types";

type Visibility = "private" | "authenticated" | "link";

interface PublishResp {
  publicationId: string;
  visibility: Visibility;
  shareToken: string | null;
  shareUrl: string | null;
  viewerEnabled: boolean;
}

const OPTIONS: { value: Visibility; label: string; desc: string; icon: typeof Globe }[] = [
  { value: "private", label: "비공개", desc: "나만 볼 수 있음", icon: Lock },
  { value: "authenticated", label: "인증 사용자 전체", desc: "로그인한 모든 사용자에게 공개", icon: Globe },
  { value: "link", label: "링크 공유", desc: "링크를 가진 누구나 (비로그인 포함)", icon: Link2 },
];

/**
 * 아티팩트 공유 모달 — Claude Code Artifacts 동등.
 * publish(visibility/icon) → 별도 오리진 엄격 CSP 뷰어 URL 발급 + 복사.
 */
export function ArtifactShareModal({
  sessionId,
  artifactId,
  defaultIcon,
  onCloseAction,
}: {
  sessionId: string;
  artifactId: string;
  defaultIcon?: string | null;
  onCloseAction: () => void;
}) {
  const onClose = onCloseAction;
  const [visibility, setVisibility] = useState<Visibility>("link");
  const [icon, setIcon] = useState(defaultIcon ?? "");
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [published, setPublished] = useState(false);

  const base = `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`;

  const publish = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await ApiClient.post<ApiSuccess<PublishResp>>(`${base}/publish`, {
        visibility,
        icon: icon.trim() || null,
        sharedVersion: null, // 항상 최신
      });
      const data = res.data;
      setPublished(true);
      if (!data.viewerEnabled) {
        setErr("뷰어가 비활성화되어 있습니다(ARTIFACT_VIEWER_ENABLED). 관리자에게 문의하세요.");
        return;
      }
      if (data.shareUrl) {
        setUrl(data.shareUrl);
      } else {
        // authenticated/private → per-user 토큰 URL 발급
        const open = await ApiClient.get<ApiSuccess<{ url: string }>>(
          `/api/artifacts/pub/${data.publicationId}/open`,
        );
        setUrl(open.data.url);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "공유에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    setBusy(true);
    setErr(null);
    try {
      await ApiClient.del(`${base}/publish`);
      setPublished(false);
      setUrl(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "공유 중단에 실패했습니다");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-fg">아티팩트 공유</h2>
          <button type="button" onClick={onClose} aria-label="닫기" className="grid h-7 w-7 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>

        <fieldset className="space-y-2" disabled={busy}>
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                  visibility === opt.value ? "border-accent bg-accent/5" : "border-border hover:bg-surface-2"
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  className="mt-1"
                  checked={visibility === opt.value}
                  onChange={() => setVisibility(opt.value)}
                />
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{opt.label}</span>
                  <span className="block text-xs text-muted">{opt.desc}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mt-3 flex items-center gap-2">
          <label className="text-xs text-muted" htmlFor="art-icon">아이콘(이모지)</label>
          <input
            id="art-icon"
            value={icon}
            onChange={(e) => setIcon(e.target.value.slice(0, 4))}
            placeholder="📊"
            className="w-16 rounded border border-border bg-surface-2 px-2 py-1 text-center text-sm"
          />
        </div>

        {err && <p className="mt-3 rounded bg-danger/10 px-3 py-2 text-xs text-danger">{err}</p>}

        {url && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2">
            <input readOnly value={url} className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none" />
            <button type="button" onClick={copy} className="grid h-7 w-7 shrink-0 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg" aria-label="링크 복사">
              {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
        )}

        <div className="mt-5 flex justify-between gap-2">
          {published ? (
            <button type="button" onClick={unpublish} disabled={busy} className="rounded-lg px-3 py-2 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50">
              공유 중단
            </button>
          ) : <span />}
          <button
            type="button"
            onClick={publish}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {published ? "공유 설정 갱신" : "공유하기"}
          </button>
        </div>
      </div>
    </div>
  );
}
