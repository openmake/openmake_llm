"use client";

/**
 * 사이드바 Knowledge 섹션 — 주요 메뉴와 최근 대화 사이. ChatGPT/Claude 의 "Projects" 처럼 Space 를 접고 펴며,
 * 펴면 그 Space 의 상세를 읽어 "새 대화" + 대화 목록을 보인다. 게스트에겐 숨긴다.
 */
import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Library, Plus, MessageSquarePlus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { SidebarSectionProps } from "../../types";
import { knowledgeApi } from "../api";
import { qk, SIDEBAR_MAX_SPACES } from "../constants";
import { useSessionActions } from "../session-actions";
import { CreateSpaceDialog } from "./create-dialog";

function SpaceRow({
  spaceId,
  name,
  icon,
  currentSessionId,
  openSession,
}: {
  spaceId: string;
  name: string;
  icon: string | null;
  currentSessionId: string | null;
  openSession: (sessionId: string) => void;
}) {
  const t = useTranslations("knowledge");
  const [expanded, setExpanded] = useState(false);
  const { startConversation } = useSessionActions();
  const { data: detail, isLoading } = useQuery({
    queryKey: qk.space(spaceId),
    queryFn: () => knowledgeApi.getSpace(spaceId),
    enabled: expanded,
  });

  return (
    <li>
      <div className="group relative flex items-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="grid h-6 w-5 shrink-0 place-items-center rounded text-faint hover:text-fg"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <Link
          href={`/knowledge/${spaceId}`}
          className="min-w-0 flex-1 truncate rounded-md px-1.5 py-1.5 text-[13px] leading-tight text-fg-2 transition hover:bg-surface-3 hover:text-fg"
        >
          <span className="mr-1">{icon || "📚"}</span>
          {name}
        </Link>
      </div>
      {expanded && (
        <ul className="ml-6 space-y-px border-l border-border pl-1.5">
          <li>
            <button
              type="button"
              onClick={() => void startConversation(spaceId)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-accent transition hover:bg-surface-3"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              {t("newConversation")}
            </button>
          </li>
          {isLoading && (
            <li className="px-2 py-1 text-[12px] text-faint">{t("loading")}</li>
          )}
          {detail?.conversations.map((c) => {
            const active = c.sessionId === currentSessionId;
            return (
              <li key={c.sessionId}>
                <button
                  type="button"
                  onClick={() => openSession(c.sessionId)}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1 text-left text-[12px] leading-tight transition",
                    active
                      ? "bg-accent-soft font-medium text-accent"
                      : "text-muted hover:bg-surface-3 hover:text-fg",
                  )}
                >
                  {c.title || t("untitledConversation")}
                </button>
              </li>
            );
          })}
          {detail && detail.conversations.length === 0 && !isLoading && (
            <li className="px-2 py-1 text-[12px] text-faint">{t("noConversations")}</li>
          )}
        </ul>
      )}
    </li>
  );
}

export function KnowledgeSidebarSection({ query, currentSessionId, openSession }: SidebarSectionProps) {
  const t = useTranslations("knowledge");
  const user = useAppStore((s) => s.auth.currentUser);
  const [createOpen, setCreateOpen] = useState(false);
  const { data: spaces = [] } = useQuery({
    queryKey: qk.spaces(),
    queryFn: knowledgeApi.listSpaces,
    enabled: !!user,
    retry: false,
  });

  if (!user) return null;

  const normalized = query.trim().toLowerCase();
  const filtered = (normalized ? spaces.filter((s) => s.name.toLowerCase().includes(normalized)) : spaces)
    .slice()
    .sort((a, b) => {
      const ta = new Date(a.lastUsedAt ?? a.updatedAt).getTime();
      const tb = new Date(b.lastUsedAt ?? b.updatedAt).getTime();
      return tb - ta;
    });
  const visible = filtered.slice(0, SIDEBAR_MAX_SPACES);

  return (
    <div className="pt-3">
      <div className="flex items-center justify-between px-1 pb-1">
        <Link
          href="/knowledge"
          className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-faint transition hover:text-fg"
        >
          <Library className="h-3.5 w-3.5" />
          {t("sectionTitle")}
        </Link>
        <button
          type="button"
          aria-label={t("create.title")}
          onClick={() => setCreateOpen(true)}
          className="grid h-5 w-5 place-items-center rounded text-faint transition hover:bg-surface-3 hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {spaces.length === 0 ? (
        <p className="px-2 py-1 text-[12px] text-faint">{t("sidebarEmpty")}</p>
      ) : (
        <ul className="space-y-px">
          {visible.map((s) => (
            <SpaceRow
              key={s.id}
              spaceId={s.id}
              name={s.name}
              icon={s.icon}
              currentSessionId={currentSessionId}
              openSession={openSession}
            />
          ))}
        </ul>
      )}

      {filtered.length > SIDEBAR_MAX_SPACES && (
        <Link
          href="/knowledge"
          className="mt-0.5 block rounded-md px-2 py-1 text-[12px] text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          {t("viewAll")} →
        </Link>
      )}

      <CreateSpaceDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
