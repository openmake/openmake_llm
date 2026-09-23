"use client";

/**
 * /knowledge/[spaceId] 상세 — 이름·설명(canEdit 시 인라인 편집), 새 대화·자료 추가·기존 대화 연결,
 * 문서 상태(처리 중일 때만 폴링)·재시도·삭제, 대화 목록(열기·연결 해제), Space 삭제.
 * ?doc=&chunk= 가 있으면 우측에 인용 미리보기 패널을 연다.
 * 레이아웃 계약: main(flex-col) 안에서 flex-1 행 — 왼쪽 스크롤 컬럼 + 오른쪽 인용 패널.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Pencil,
  Check,
  X,
  Upload,
  MessageSquarePlus,
  Link2,
  Unlink,
  Trash2,
  Loader2,
  FileText,
  MessageSquare,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/primitives";
import { knowledgeApi } from "../api";
import { qk, PROCESSING_POLL_MS } from "../constants";
import { isProcessing } from "../helpers";
import { useSessionActions } from "../session-actions";
import { DocumentList } from "../components/document-list";
import { BindConversationDialog } from "../components/bind-picker";
import { CitationPanel } from "../components/citation-panel";

export function SpaceDetail({
  spaceId,
  docId,
  chunkId,
}: {
  spaceId: string;
  docId: string | null;
  chunkId: string | null;
}) {
  const t = useTranslations("knowledge");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { openSession, startConversation } = useSessionActions();
  const fileRef = useRef<HTMLInputElement>(null);

  const [bindOpen, setBindOpen] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [citationOpen, setCitationOpen] = useState<boolean>(!!(docId && chunkId));

  const { data: caps } = useQuery({
    queryKey: qk.capabilities(),
    queryFn: knowledgeApi.capabilities,
    retry: false,
  });

  const { data: space, isLoading } = useQuery({
    queryKey: qk.space(spaceId),
    queryFn: () => knowledgeApi.getSpace(spaceId),
    retry: false,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && d.documents.some((doc) => isProcessing(doc.status)) ? PROCESSING_POLL_MS : false;
    },
  });

  useEffect(() => setCitationOpen(!!(docId && chunkId)), [docId, chunkId]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: qk.space(spaceId) });

  const saveName = async () => {
    const name = (editName ?? "").trim();
    if (name && space && name !== space.name) {
      await knowledgeApi.updateSpace(spaceId, { name });
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: qk.spaces() });
    }
    setEditName(null);
  };

  const saveDesc = async () => {
    const description = (editDesc ?? "").trim();
    await knowledgeApi.updateSpace(spaceId, { description: description || null });
    void invalidate();
    setEditDesc(null);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일 재선택 허용
    if (!file) return;
    setUploadError(null);
    if (caps && caps.maxFileBytes > 0 && file.size > caps.maxFileBytes) {
      setUploadError(t("upload.tooLarge"));
      return;
    }
    setUploading(true);
    try {
      await knowledgeApi.uploadDocument(spaceId, file);
      void invalidate();
    } catch (err) {
      const e2 = err as Error & { status?: number; code?: string };
      if (e2.status === 409 || e2.code === "DUPLICATE_DOCUMENT") setUploadError(t("upload.duplicate"));
      else setUploadError(e2.message || t("serverError"));
    } finally {
      setUploading(false);
    }
  };

  const unbind = async (sessionId: string) => {
    if (!window.confirm(t("conv.unbindConfirm"))) return;
    await knowledgeApi.unbindConversation(spaceId, sessionId);
    void invalidate();
  };

  const removeSpace = async () => {
    if (!space || !window.confirm(t("deleteSpaceConfirm", { name: space.name }))) return;
    await knowledgeApi.deleteSpace(spaceId);
    void queryClient.invalidateQueries({ queryKey: qk.spaces() });
    router.push("/knowledge");
  };

  const canEdit = space?.canEdit ?? false;
  const accept = caps?.supportedMimeTypes?.join(",");

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 헤더 — 뒤로가기 + 이름(인라인 편집) + 주요 동작 */}
        <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Link
            href="/knowledge"
            aria-label={t("back")}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint transition hover:bg-surface-3 hover:text-fg"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {editName !== null ? (
              <>
                <input
                  autoFocus
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveName();
                    if (e.key === "Escape") setEditName(null);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-base font-bold text-fg outline-none focus:border-accent"
                />
                <button type="button" aria-label={t("save")} onClick={() => void saveName()} className="text-accent">
                  <Check className="h-4 w-4" />
                </button>
                <button type="button" aria-label={t("cancel")} onClick={() => setEditName(null)} className="text-faint">
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className="mr-1 text-xl">{space?.icon || "📚"}</span>
                <h1 className="truncate text-lg font-bold text-fg">{space?.name ?? (isLoading ? "…" : t("notFound"))}</h1>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t("rename")}
                    onClick={() => setEditName(space?.name ?? "")}
                    className="shrink-0 text-faint transition hover:text-fg"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" onClick={() => void startConversation(spaceId)}>
              <MessageSquarePlus className="h-4 w-4" />
              {t("newConversation")}
            </Button>
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {t("upload.add")}
              </Button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            onChange={(e) => void onPickFile(e)}
            className="hidden"
          />
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
          {/* 설명 */}
          <section>
            {editDesc !== null ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void saveDesc()}>{t("save")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setEditDesc(null)}>{t("cancel")}</Button>
                </div>
              </div>
            ) : (
              <div className="group flex items-start gap-2">
                <p className="text-sm text-muted">{space?.description || t("noDescription")}</p>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t("editDescription")}
                    onClick={() => setEditDesc(space?.description ?? "")}
                    className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100 hover:text-fg"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </section>

          {uploadError && <p className="text-sm text-danger">{uploadError}</p>}
          {caps && !caps.ready && (
            <p className="rounded-md border border-warn/40 bg-warn-soft/30 px-3 py-2 text-xs text-warn">
              {t("notReadyNotice")}
            </p>
          )}

          {/* 문서 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <FileText className="h-4 w-4 text-muted" />
                {t("doc.section", { count: space?.documentCount ?? 0 })}
              </h2>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  <Upload className="h-3.5 w-3.5" />
                  {t("upload.add")}
                </Button>
              )}
            </div>
            {space && <DocumentList spaceId={spaceId} documents={space.documents} canEdit={canEdit} />}
          </section>

          {/* 대화 */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                <MessageSquare className="h-4 w-4 text-muted" />
                {t("conv.section", { count: space?.conversationCount ?? 0 })}
              </h2>
              <Button size="sm" variant="ghost" onClick={() => setBindOpen(true)}>
                <Link2 className="h-3.5 w-3.5" />
                {t("conv.bindExisting")}
              </Button>
            </div>
            {space && space.conversations.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-faint">
                {t("noConversations")}
              </p>
            ) : (
              <ul className="space-y-1">
                {space?.conversations.map((c) => (
                  <li key={c.sessionId} className="group flex items-center gap-2 rounded-md border border-border px-3 py-2">
                    <button
                      type="button"
                      onClick={() => void openSession(c.sessionId)}
                      className="min-w-0 flex-1 truncate text-left text-sm text-fg-2 transition hover:text-fg"
                    >
                      {c.title || t("untitledConversation")}
                    </button>
                    <button
                      type="button"
                      aria-label={t("conv.unbind")}
                      onClick={() => void unbind(c.sessionId)}
                      className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100 hover:text-danger"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 위험 구역 */}
          {canEdit && (
            <section className="border-t border-border pt-4">
              <Button variant="danger" size="sm" onClick={() => void removeSpace()}>
                <Trash2 className="h-4 w-4" />
                {t("deleteSpace")}
              </Button>
            </section>
          )}
        </div>
      </div>

      {citationOpen && docId && chunkId && (
        <CitationPanel spaceId={spaceId} chunkId={chunkId} onClose={() => setCitationOpen(false)} />
      )}

      <BindConversationDialog spaceId={spaceId} open={bindOpen} onClose={() => setBindOpen(false)} />
    </div>
  );
}
