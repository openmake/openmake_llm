"use client";

/**
 * 채팅 헤더의 대화 공유 버튼 — 저장된 세션이 열려 있을 때만 활성. 세션이 바뀌면(계정 전환 포함) 모달은 닫힌다.
 */
import { useState } from "react";
import { Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/lib/store";
import { ConversationShareModal } from "./conversation-share-modal";

export function ConversationShareButton() {
  const t = useTranslations("conversationShare");
  const sessionId = useAppStore((s) => s.currentSessionId);
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = sessionId !== null && openFor === sessionId;

  return (
    <>
      <button
        type="button"
        disabled={!sessionId}
        title={sessionId ? undefined : t("noSession")}
        aria-haspopup="dialog"
        onClick={() => setOpenFor(sessionId)}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-2 transition hover:bg-surface-3 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
      >
        <Share2 className="h-3.5 w-3.5" />
        {t("button")}
      </button>
      {open && <ConversationShareModal key={sessionId} sessionId={sessionId} onCloseAction={() => setOpenFor(null)} />}
    </>
  );
}
