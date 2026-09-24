"use client";

/**
 * 채팅 상단 Knowledge 배너 — 열린 대화가 Space 에 연결돼 있으면 얇은 표시줄을 보인다(표시일 뿐, 권한 근거 아님).
 * 서버 GET /api/knowledge/bindings/:sessionId 로 판정하고, 세션이 없으면 조회 자체를 건너뛴다.
 */
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { knowledgeApi } from "../api";
import { qk } from "../constants";

export function KnowledgeChatBanner({ sessionId }: { sessionId: string | null }) {
  const t = useTranslations("knowledge");
  const { data } = useQuery({
    queryKey: sessionId ? qk.binding(sessionId) : ["knowledge", "binding", "none"],
    queryFn: () => knowledgeApi.getBinding(sessionId!),
    enabled: !!sessionId,
    retry: false,
  });

  const space = data?.space;
  if (!space) return null;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-accent-soft/40 px-5 py-1.5 text-xs text-fg-2">
      <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
      <Link href={`/knowledge/${space.id}`} className="font-medium text-accent hover:underline">
        <span className="mr-1">{space.icon || "📚"}</span>
        {space.name}
      </Link>
      <span className="truncate text-muted">{t("banner.text")}</span>
    </div>
  );
}
