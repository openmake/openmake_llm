"use client";

/** Space 문서 목록 — 상태 라벨·진행률, 실패 사유(i18n) + 재시도, 삭제. 처리 폴링은 상세가 담당한다. */
import { useState } from "react";
import { FileText, RefreshCw, Trash2, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { KnowledgeDocument } from "@openmake/shared-types";
import { knowledgeApi } from "../api";
import { qk } from "../constants";
import { failureMessageKey, formatBytes, isProcessing, statusLabelKey } from "../helpers";

function DocRow({ spaceId, doc, canEdit }: { spaceId: string; doc: KnowledgeDocument; canEdit: boolean }) {
  const t = useTranslations("knowledge");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"retry" | "delete" | null>(null);
  const processing = isProcessing(doc.status);
  const failed = doc.status === "failed";

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.space(spaceId) });

  const retry = async () => {
    setBusy("retry");
    try {
      await knowledgeApi.retryDocument(spaceId, doc.id);
      void invalidate();
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(t("doc.deleteConfirm", { name: doc.name }))) return;
    setBusy("delete");
    try {
      await knowledgeApi.deleteDocument(spaceId, doc.id);
      void invalidate();
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex items-start gap-3 rounded-md border border-border p-3">
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded bg-surface-2 text-muted">
        {failed ? (
          <AlertTriangle className="h-4 w-4 text-danger" />
        ) : doc.status === "ready" ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <FileText className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-fg">{doc.name}</p>
          <span className="shrink-0 text-xs text-faint">{formatBytes(doc.sizeBytes)}</span>
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {t(statusLabelKey(doc.status))}
          {doc.pageCount != null && ` · ${t("doc.pages", { count: doc.pageCount })}`}
        </p>
        {processing && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, Math.max(0, doc.progress))}%` }}
            />
          </div>
        )}
        {failed && (
          <p className="mt-1 text-xs text-danger">{t(failureMessageKey(doc.failureCode))}</p>
        )}
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-center gap-1">
          {failed && (
            <button
              type="button"
              aria-label={t("doc.retry")}
              onClick={() => void retry()}
              disabled={busy !== null}
              className="grid h-7 w-7 place-items-center rounded text-faint transition hover:bg-surface-3 hover:text-accent disabled:opacity-50"
            >
              {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            aria-label={t("doc.delete")}
            onClick={() => void remove()}
            disabled={busy !== null}
            className="grid h-7 w-7 place-items-center rounded text-faint transition hover:bg-surface-3 hover:text-danger disabled:opacity-50"
          >
            {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}
    </li>
  );
}

export function DocumentList({
  spaceId,
  documents,
  canEdit,
}: {
  spaceId: string;
  documents: KnowledgeDocument[];
  canEdit: boolean;
}) {
  const t = useTranslations("knowledge");
  if (documents.length === 0) {
    return <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-faint">{t("doc.empty")}</p>;
  }
  return (
    <ul className="space-y-2">
      {documents.map((d) => (
        <DocRow key={d.id} spaceId={spaceId} doc={d} canEdit={canEdit} />
      ))}
    </ul>
  );
}
