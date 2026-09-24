"use client";

/**
 * /knowledge 목록 화면 — Space 카드(아이콘·이름·문서/대화 수·최근 사용·처리/실패 배지)와 생성.
 * 관리자에겐 상단에 "관리" 패널(가용성·임베딩 인덱스·잡·재색인·프로파일 편집)을 함께 보인다.
 * 레이아웃 계약: fragment 루트 + 고정 헤더 + min-h-0 flex-1 overflow-y-auto 본문.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, FileText, MessageSquare, AlertTriangle, Loader2, Library } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, PageHeader } from "@/components/ui/primitives";
import { useAppStore } from "@/lib/store";
import type { KnowledgeSpaceSummary } from "@openmake/shared-types";
import { knowledgeApi } from "../api";
import { qk } from "../constants";
import { parseDate } from "../helpers";
import { CreateSpaceDialog } from "../components/create-dialog";
import { KnowledgeAdminPanel } from "../components/admin-panel";

function SpaceCard({ space }: { space: KnowledgeSpaceSummary }) {
  const t = useTranslations("knowledge");
  const last = parseDate(space.lastUsedAt);
  return (
    <Link href={`/knowledge/${space.id}`} className="block">
      <Card className="h-full p-4 transition hover:border-border-strong hover:shadow-2">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent-soft text-lg">
            {space.icon || "📚"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{space.name}</p>
            {space.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted">{space.description}</p>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {t("card.documents", { count: space.documentCount })}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" />
            {t("card.conversations", { count: space.conversationCount })}
          </span>
          {last && <span className="text-faint">{t("card.lastUsed", { date: last.toLocaleDateString() })}</span>}
        </div>
        {(space.processingCount > 0 || space.failedCount > 0) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {space.processingCount > 0 && (
              <Badge tone="warn">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("card.processing", { count: space.processingCount })}
              </Badge>
            )}
            {space.failedCount > 0 && (
              <Badge tone="danger">
                <AlertTriangle className="h-3 w-3" />
                {t("card.failed", { count: space.failedCount })}
              </Badge>
            )}
          </div>
        )}
      </Card>
    </Link>
  );
}

export function SpaceListView() {
  const router = useRouter();
  const t = useTranslations("knowledge");
  const isAdmin = useAppStore((s) => s.auth.currentUser?.role === "admin");
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: spaces = [], isLoading } = useQuery({
    queryKey: qk.spaces(),
    queryFn: knowledgeApi.listSpaces,
    retry: false,
  });

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? spaces.filter((s) => s.name.toLowerCase().includes(normalized))
    : spaces;

  return (
    <>
      <PageHeader
        title={t("sectionTitle")}
        description={t("listSubtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("newSpace")}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
        {isAdmin && <KnowledgeAdminPanel />}

        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 sm:max-w-sm">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted">{t("loading")}</p>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border py-16 text-center">
            <Library className="h-8 w-8 text-faint" />
            <p className="text-sm text-muted">{spaces.length === 0 ? t("empty") : t("noResults")}</p>
            {spaces.length === 0 && (
              <Button variant="outline" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t("newSpace")}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((s) => (
              <SpaceCard key={s.id} space={s} />
            ))}
          </div>
        )}
      </div>

      <CreateSpaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => router.push(`/knowledge/${id}`)}
      />
    </>
  );
}
