"use client";

/** "기존 대화 추가" 선택기 — 사용자의 최근 대화를 나열해 하나를 이 Space 에 연결(bind)한다. */
import { useState } from "react";
import { Loader2, Link2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { appendAnonSessionId } from "@/lib/anon-session";
import { Button, Dialog } from "@/components/ui/primitives";
import { knowledgeApi, type RecentChat } from "../api";
import { qk, BIND_PICKER_RECENT_LIMIT } from "../constants";

interface SessionRow {
  id?: string;
  sessionId?: string;
  title?: string;
  name?: string;
}

export function BindConversationDialog({
  spaceId,
  open,
  onClose,
}: {
  spaceId: string;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("knowledge");
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: recent = [], isLoading } = useQuery<RecentChat[]>({
    queryKey: ["knowledge", "recentChats"],
    queryFn: async () => {
      const res = await ApiClient.get<ApiSuccess<{ sessions?: SessionRow[] }>>(
        appendAnonSessionId("/api/chat/conversations"),
      );
      return (res?.data?.sessions ?? [])
        .map((s) => ({ sessionId: s.id ?? s.sessionId ?? "", title: s.title ?? s.name ?? "" }))
        .filter((s) => s.sessionId)
        .slice(0, BIND_PICKER_RECENT_LIMIT);
    },
    enabled: open,
    retry: false,
  });

  const bind = async (sessionId: string) => {
    setBusyId(sessionId);
    try {
      await knowledgeApi.bindConversation(spaceId, sessionId);
      void queryClient.invalidateQueries({ queryKey: qk.space(spaceId) });
      onClose();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={t("bind.title")}>
      <p className="mb-3 text-xs text-muted">{t("bind.hint")}</p>
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-muted">{t("loading")}</p>
        ) : recent.length === 0 ? (
          <p className="text-sm text-faint">{t("bind.noChats")}</p>
        ) : (
          recent.map((c) => (
            <button
              key={c.sessionId}
              type="button"
              onClick={() => void bind(c.sessionId)}
              disabled={busyId !== null}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-fg-2 transition hover:bg-surface-3 hover:text-fg disabled:opacity-50"
            >
              {busyId === c.sessionId ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4 shrink-0 text-faint" />
              )}
              <span className="truncate">{c.title || t("untitledConversation")}</span>
            </button>
          ))
        )}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </Dialog>
  );
}
