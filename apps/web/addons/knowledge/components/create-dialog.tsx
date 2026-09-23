"use client";

/** Knowledge 생성 대화상자 — 이름(필수)·설명(선택). 성공 시 목록/사이드바를 무효화하고 콜백에 새 id 를 준다. */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@/components/ui/primitives";
import { knowledgeApi } from "../api";
import { qk } from "../constants";

export function CreateSpaceDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (spaceId: string) => void;
}) {
  const t = useTranslations("knowledge");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError(t("create.nameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const space = await knowledgeApi.createSpace({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      void queryClient.invalidateQueries({ queryKey: qk.spaces() });
      reset();
      onClose();
      onCreated?.(space.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("serverError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("create.title")}>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("create.nameLabel")}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={t("create.namePlaceholder")}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("create.descLabel")}</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={t("create.descPlaceholder")}
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("create.submit")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
