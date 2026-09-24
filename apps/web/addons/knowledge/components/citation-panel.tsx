"use client";

/**
 * 인용 미리보기 패널(우측) — 채팅 출처 칩이 /knowledge/:id?doc=&chunk= 로 링크하면 그 청크 조각을 보인다.
 * 문서명·페이지·본문(순수 텍스트, HTML 렌더 없음)만 표시한다.
 */
import { X, FileText } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { knowledgeApi } from "../api";
import { qk } from "../constants";

export function CitationPanel({
  spaceId,
  chunkId,
  onClose,
}: {
  spaceId: string;
  chunkId: string;
  onClose: () => void;
}) {
  const t = useTranslations("knowledge");
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.chunk(spaceId, chunkId),
    queryFn: () => knowledgeApi.getChunk(spaceId, chunkId),
    retry: false,
  });

  const pageLabel =
    data && data.pageStart != null
      ? data.pageEnd != null && data.pageEnd !== data.pageStart
        ? t("citation.pages", { start: data.pageStart, end: data.pageEnd })
        : t("citation.page", { page: data.pageStart })
      : null;

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-surface shadow-xl lg:static lg:z-auto lg:w-80 lg:shrink-0 lg:bg-surface-2/40 lg:shadow-none">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg">
          <FileText className="h-4 w-4 shrink-0 text-accent" />
          <span className="truncate">{data?.documentName || t("citation.title")}</span>
        </span>
        <button
          type="button"
          aria-label={t("close")}
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-faint transition hover:bg-surface-3 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {pageLabel && <p className="mb-2 text-xs font-medium text-muted">{pageLabel}</p>}
        {isLoading ? (
          <p className="text-sm text-muted">{t("loading")}</p>
        ) : isError || !data ? (
          <p className="text-sm text-danger">{t("citation.loadFailed")}</p>
        ) : (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-2">
            {data.content}
          </p>
        )}
      </div>
    </aside>
  );
}
