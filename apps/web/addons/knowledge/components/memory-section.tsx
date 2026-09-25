"use client";

/**
 * 프로젝트 메모리 섹션(수동) — 소유자가 손으로 적어 두는 항목. 목록·추가·편집·삭제.
 * 읽기 권한이면 목록을 보고, canEdit 이면 추가·편집·삭제할 수 있다. 자동 추출은 없다.
 */
import { useState } from "react";
import { Plus, Pencil, Check, X, Trash2, Loader2, Brain } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/primitives";
import { knowledgeApi } from "../api";
import { qk } from "../constants";

export function MemorySection({ spaceId, canEdit }: { spaceId: string; canEdit: boolean }) {
  const t = useTranslations("knowledge");
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: memories = [] } = useQuery({
    queryKey: qk.memories(spaceId),
    queryFn: () => knowledgeApi.listMemories(spaceId),
    retry: false,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.memories(spaceId) });

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      void invalidate();
      after();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("serverError"));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const content = draft.trim();
    if (!content) return;
    void run(() => knowledgeApi.addMemory(spaceId, content), () => { setDraft(""); setAdding(false); });
  };

  const saveEdit = () => {
    const content = editText.trim();
    if (!content || !editId) return;
    void run(() => knowledgeApi.updateMemory(spaceId, editId, content), () => setEditId(null));
  };

  const remove = (memId: string) => {
    if (!window.confirm(t("memory.deleteConfirm"))) return;
    void run(() => knowledgeApi.deleteMemory(spaceId, memId), () => undefined);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
          <Brain className="h-4 w-4 text-muted" />
          {t("memory.section", { count: memories.length })}
        </h2>
        {canEdit && !adding && (
          <Button size="sm" variant="ghost" onClick={() => { setAdding(true); setDraft(""); }}>
            <Plus className="h-3.5 w-3.5" />
            {t("memory.add")}
          </Button>
        )}
      </div>

      <p className="text-xs text-faint">{t("memory.hint")}</p>

      {adding && (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={t("memory.placeholder")}
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={busy || !draft.trim()}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("memory.save")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)} disabled={busy}>{t("cancel")}</Button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {memories.length === 0 && !adding ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-faint">
          {t("memory.empty")}
        </p>
      ) : (
        <ul className="space-y-1">
          {memories.map((m) => (
            <li key={m.id} className="group rounded-md border border-border px-3 py-2">
              {editId === m.id ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    className="w-full resize-none rounded-md border border-border bg-surface px-2 py-1 text-sm text-fg outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button type="button" aria-label={t("save")} onClick={saveEdit} className="text-accent" disabled={busy}>
                      <Check className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={t("cancel")} onClick={() => setEditId(null)} className="text-faint">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-fg-2">{m.content}</p>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={t("rename")}
                        onClick={() => { setEditId(m.id); setEditText(m.content); }}
                        className="text-faint hover:text-fg"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={t("memory.delete")}
                        onClick={() => remove(m.id)}
                        className="text-faint hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
