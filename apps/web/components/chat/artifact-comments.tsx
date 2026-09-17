"use client";

/**
 * 아티팩트 댓글 (F20.6, 147) — 목록·답글(1단계)·해결·삭제와 "모델에게 반영 요청".
 *
 * 반영 요청은 새 채널을 만들지 않고 댓글 본문을 인용한 요청문을 컴포저 드래프트(store.inputDraft)로 넣는다.
 * 본문은 마크다운 평문 — `Markdown`(rehype-raw 없음)으로 렌더한다. 실시간 갱신은 없고 동작 후 재조회한다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, CornerDownRight, Loader2, Trash2, Wand2 } from "lucide-react";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import type { ApiSuccess } from "@openmake/shared-types";
import { Markdown } from "./markdown";

interface CommentRow {
  id: string;
  version: number;
  user_id: string;
  parent_id: string | null;
  body: string | null;
  resolved_at: string | null;
  deleted: boolean;
  created_at: string;
}

const BODY_MAX = 4000;

/** allowApply=false — 대화 밖(갤러리)에서는 반영 요청이 엉뚱한 세션의 컴포저로 들어가므로 숨긴다. */
export function ArtifactComments({ sessionId, artifactId, title, allowApply = true }: { sessionId: string; artifactId: string; title: string; allowApply?: boolean }) {
  const t = useTranslations("artifacts.comments");
  const myId = useAppStore((s) => (s.auth.currentUser?.id != null ? String(s.auth.currentUser.id) : null));
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/comments`;

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<ApiSuccess<{ comments: CommentRow[]; canWrite: boolean }>>(base);
      setRows(r?.data?.comments ?? []);
      setCanWrite(!!r?.data?.canWrite);
      setError(null);
    } catch {
      setError(t("loadFailed"));
    } finally {
      setLoaded(true);
    }
  }, [base, t]);
  useEffect(() => { setLoaded(false); setRows([]); void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try { await fn(); await load(); }
    catch { setError(t("actionFailed")); }
    finally { setBusy(false); }
  }

  const submit = () => run(async () => {
    await ApiClient.post(base, { body: text, ...(replyTo ? { parentId: replyTo } : {}) });
    setText(""); setReplyTo(null);
  });
  const toggleResolved = (c: CommentRow) => run(() => ApiClient.patch(`/api/artifact-comments/${c.id}`, { resolved: !c.resolved_at }));
  const remove = (c: CommentRow) => { if (confirm(t("deleteConfirm"))) void run(() => ApiClient.del(`/api/artifact-comments/${c.id}`)); };
  const askModel = (c: CommentRow) => {
    const quoted = (c.body ?? "").split("\n").map((l) => `> ${l}`).join("\n");
    setInputDraft(`${t("applyPrompt", { title })}\n\n${quoted}\n`);
  };

  const topLevel = rows.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => rows.filter((c) => c.parent_id === id);

  const item = (c: CommentRow, isReply: boolean) => (
    <div key={c.id} className={isReply ? "ml-4 border-l border-border pl-2" : ""}>
      <div className="flex items-center gap-1.5 text-[10px] text-faint">
        {isReply && <CornerDownRight className="h-3 w-3" />}
        <span className="font-mono">{c.user_id === myId ? t("me") : t("user", { id: c.user_id })}</span>
        <span>· v{c.version}</span>
        <span>· {new Date(c.created_at).toLocaleString()}</span>
        {c.resolved_at && <span className="rounded bg-success-soft px-1 text-success">{t("resolved")}</span>}
      </div>
      {c.deleted ? (
        <p className="text-xs italic text-faint">{t("deletedPlaceholder")}</p>
      ) : (
        <div className="text-xs text-fg-1 [&_p]:my-0.5"><Markdown content={c.body ?? ""} /></div>
      )}
      {!c.deleted && (
        <div className="mt-0.5 flex flex-wrap gap-2 text-[10px]">
          {canWrite && !isReply && (
            <button type="button" className="text-accent hover:underline" onClick={() => setReplyTo(c.id)}>{t("reply")}</button>
          )}
          {canWrite && !isReply && (
            <button type="button" className="text-muted hover:text-fg" onClick={() => toggleResolved(c)} disabled={busy}>
              {c.resolved_at ? t("unresolve") : t("resolve")}
            </button>
          )}
          {allowApply && (
            <button type="button" className="inline-flex items-center gap-0.5 text-muted hover:text-fg" onClick={() => askModel(c)} title={t("applyHint")}>
              <Wand2 className="h-3 w-3" /> {t("apply")}
            </button>
          )}
          {canWrite && (
            <button type="button" className="inline-flex items-center gap-0.5 text-muted hover:text-danger" onClick={() => remove(c)} disabled={busy} aria-label={t("delete")}>
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {!loaded ? (
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-faint" />
        ) : topLevel.length === 0 ? (
          <p className="text-xs text-muted">{t("empty")}</p>
        ) : (
          topLevel.map((c) => (
            <div key={c.id} className="space-y-1.5 rounded-md border border-border bg-surface-1 p-2">
              {item(c, false)}
              {repliesOf(c.id).map((r) => item(r, true))}
            </div>
          ))
        )}
        {error && <p className="text-[11px] text-danger" role="alert">{error}</p>}
      </div>
      {canWrite && (
        <div className="border-t border-border p-2">
          {replyTo && (
            <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
              <span>{t("replying")}</span>
              <button type="button" className="hover:text-fg" onClick={() => setReplyTo(null)}>{t("cancelReply")}</button>
            </div>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, BODY_MAX))}
            placeholder={t("placeholder")}
            rows={2}
            className="w-full resize-y rounded-md border border-border bg-surface-2 p-1.5 text-xs text-fg-1"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={submit}
              className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {t("submit")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
