"use client";

/**
 * 히스토리 폴더 레일 (F19.5) — 전체·미분류·폴더 목록(세션 수)·새 폴더·이름 변경·삭제 + 태그 칩 필터.
 * 선택은 부모가 서버 필터(?folderId=·?tag=)로 조회한다.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Folder, FolderPlus, Inbox, Layers, Pencil, Tag, Trash2, Check, X } from "lucide-react";
import type { ConversationFolder } from "@openmake/shared-types";
import { cn } from "@/lib/utils";

export interface HistoryFilter {
  /** 폴더 id 또는 'none'(미분류). 없으면 전체 */
  folderId?: string;
  tag?: string;
}

const inputCls = "h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

export function FolderRail({
  folders,
  tags,
  filter,
  onFilter,
  onCreate,
  onRename,
  onDelete,
}: {
  folders: ConversationFolder[];
  /** 현재 목록에서 모은 태그(많이 쓰인 순) */
  tags: string[];
  filter: HistoryFilter;
  onFilter: (f: HistoryFilter) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (folder: ConversationFolder) => Promise<void>;
}) {
  const t = useTranslations("history.folders");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submitCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    try {
      await onCreate(name);
      setNewName("");
      setCreating(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    }
  };

  const submitRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    setError(null);
    try {
      await onRename(id, name);
      setEditingId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    }
  };

  const item = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition",
      active ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
    );

  return (
    <nav aria-label={t("railLabel")} className="space-y-4">
      <div className="space-y-0.5">
        <button type="button" className={item(!filter.folderId && !filter.tag)} onClick={() => onFilter({})} aria-pressed={!filter.folderId && !filter.tag}>
          <Layers className="h-4 w-4 flex-shrink-0" /> {t("all")}
        </button>
        <button type="button" className={item(filter.folderId === "none")} onClick={() => onFilter({ ...filter, folderId: "none" })} aria-pressed={filter.folderId === "none"}>
          <Inbox className="h-4 w-4 flex-shrink-0" /> {t("unfiled")}
        </button>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between px-2">
          <h2 className="font-mono text-xs uppercase tracking-wide text-muted">{t("heading")}</h2>
          <button type="button" onClick={() => setCreating((v) => !v)} aria-label={t("create")} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg">
            <FolderPlus className="h-4 w-4" />
          </button>
        </div>
        {creating && (
          <form className="mb-2 flex gap-1 px-1" onSubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={64} placeholder={t("namePlaceholder")} aria-label={t("namePlaceholder")} className={inputCls} />
            <button type="submit" aria-label={t("save")} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-accent hover:bg-surface-2"><Check className="h-4 w-4" /></button>
          </form>
        )}
        {error && <p role="alert" className="mb-1 px-2 text-xs text-danger">{error}</p>}
        {folders.length === 0 && !creating && <p className="px-2 text-xs text-muted">{t("empty")}</p>}
        <ul className="space-y-0.5">
          {folders.map((f) => (
            <li key={f.id} className="group relative">
              {editingId === f.id ? (
                <form className="flex gap-1 px-1" onSubmit={(e) => { e.preventDefault(); void submitRename(f.id); }}>
                  <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={64} aria-label={t("rename")} className={inputCls} />
                  <button type="submit" aria-label={t("save")} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-accent hover:bg-surface-2"><Check className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setEditingId(null)} aria-label={t("cancel")} className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2"><X className="h-4 w-4" /></button>
                </form>
              ) : (
                <div className="flex items-center">
                  <button type="button" className={item(filter.folderId === f.id)} onClick={() => onFilter({ ...filter, folderId: f.id })} aria-pressed={filter.folderId === f.id}>
                    <Folder className="h-4 w-4 flex-shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="font-mono text-xs text-muted">{f.sessionCount}</span>
                  </button>
                  <div className="flex opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                    <button type="button" onClick={() => { setEditingId(f.id); setEditName(f.name); }} aria-label={t("renameAria", { name: f.name })} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"><Pencil className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => void onDelete(f)} aria-label={t("deleteAria", { name: f.name })} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-danger"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      {tags.length > 0 && (
        <div>
          <h2 className="mb-1 px-2 font-mono text-xs uppercase tracking-wide text-muted">{t("tags")}</h2>
          <div className="flex flex-wrap gap-1 px-1">
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onFilter({ ...filter, tag: filter.tag === tag ? undefined : tag })}
                aria-pressed={filter.tag === tag}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition",
                  filter.tag === tag ? "border-accent bg-accent-soft text-accent" : "border-border text-fg-2 hover:border-border-strong",
                )}
              >
                <Tag className="h-3 w-3" /> {tag}
              </button>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
