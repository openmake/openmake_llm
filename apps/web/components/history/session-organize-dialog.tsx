"use client";

/**
 * 대화 정리 대화상자 (F19.5) — 폴더 이동·태그 편집. 저장은 PATCH /api/chat/sessions/:id {folderId, tags}.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConversationFolder } from "@openmake/shared-types";
import { Button, Dialog } from "@/components/ui/primitives";

const selectCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

/** 쉼표·줄바꿈으로 나눈 태그 — 서버가 최종 정규화한다 */
export function splitTagInput(raw: string): string[] {
  return raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

export function SessionOrganizeDialog({
  open,
  title,
  folders,
  initialFolderId,
  initialTags,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  folders: ConversationFolder[];
  initialFolderId: string | null;
  initialTags: string[];
  onClose: () => void;
  onSave: (patch: { folderId: string | null; tags: string[] }) => Promise<void>;
}) {
  const t = useTranslations("history.folders");
  const [folderId, setFolderId] = useState<string>(initialFolderId ?? "");
  const [tagInput, setTagInput] = useState(initialTags.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFolderId(initialFolderId ?? "");
    setTagInput(initialTags.join(", "));
    setError(null);
  }, [open, initialFolderId, initialTags]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ folderId: folderId || null, tags: splitTagInput(tagInput) });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("organizeTitle")}>
      <p className="mb-3 truncate text-sm text-muted">{title}</p>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block text-xs font-medium text-fg-2">
          {t("folderLabel")}
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={`${selectCls} mt-1`}>
            <option value="">{t("unfiled")}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-fg-2">
          {t("tagsLabel")}
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder={t("tagsPlaceholder")} className={`${selectCls} mt-1`} />
          <span className="mt-1 block font-normal text-muted">{t("tagsHelp")}</span>
        </label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>{t("cancel")}</Button>
          <Button type="submit" size="sm" disabled={saving}>{t("save")}</Button>
        </div>
      </form>
    </Dialog>
  );
}
