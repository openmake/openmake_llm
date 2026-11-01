"use client";

/**
 * Knowledge 생성 대화상자 — 이름(필수)·설명(선택). 성공 시 목록/사이드바를 무효화하고 콜백에 새 id 를 준다.
 * 색인 모델은 내 실효 임베딩 설정으로 고정된다 — capabilities.embedding(서버 판정)을 한 줄로 보이고,
 * 실행할 수 없는 상태면 경고만 한다(생성 버튼은 막지 않는다 — 서버가 412 로 판정한다).
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog } from "@/components/ui/primitives";
import { knowledgeApi } from "../api";
import { qk } from "../constants";
import { EmbeddingErrorText, EmbeddingSettingsLink, toCodedError, type CodedError } from "./embedding-notice";

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
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CodedError | null>(null);
  const { data: caps } = useQuery({
    queryKey: qk.capabilities(),
    queryFn: knowledgeApi.capabilities,
    retry: false,
    enabled: open,
  });
  const embedding = caps?.embedding ?? null;
  const embeddingBlocked = !!caps && (!embedding || embedding.status !== "ready");

  const reset = () => {
    setName("");
    setDescription("");
    setInstructions("");
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError({ message: t("create.nameRequired") });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const space = await knowledgeApi.createSpace({
        name: name.trim(),
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
      });
      void queryClient.invalidateQueries({ queryKey: qk.spaces() });
      reset();
      onClose();
      onCreated?.(space.id);
    } catch (e) {
      setError(toCodedError(e, t("serverError")));
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
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("create.instructionsLabel")}</span>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder={t("create.instructionsPlaceholder")}
            className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
          />
        </label>
        {embedding && (
          <p className="text-xs text-muted">
            {t("embedding.createNotice", { model: embedding.modelId })}
          </p>
        )}
        {embeddingBlocked && (
          <p className="text-xs text-warn">
            {t("embedding.createWarn")}
            <EmbeddingSettingsLink />
          </p>
        )}
        {error && <EmbeddingErrorText error={error} />}
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
