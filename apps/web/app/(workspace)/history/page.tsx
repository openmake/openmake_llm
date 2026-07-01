"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Search, MessageSquare, Trash2 } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Badge, PageHeader, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { toBcp47 } from "@/i18n/config";
import { appendAnonSessionId } from "@/lib/anon-session";
import { useAppStore } from "@/lib/store";
import type { ChatRole } from "@/lib/store";

/* ── 타입 ────────────────────────────────────────────────── */
type DateGroup = "today" | "yesterday" | "week" | "older";

interface Session {
  id: string;
  title: string;
  preview: string;
  time: string;
  model: string;
  group: DateGroup;
}

/* ── 백엔드 응답 타입 (GET /api/chat/conversations → res.data.sessions, camelCase) ──
 * 이 엔드포인트는 camelCase(updatedAt/createdAt) 로 응답하므로 shared-types
 * ConversationSession(snake_case) 과 형태가 달라 로컬 계약을 유지한다. envelope 만 shared 로. */
interface ApiConversation {
  id: string;
  title: string | null;
  updatedAt?: string;
  createdAt?: string;
  model?: string;
  messageCount?: number;
}

type ConversationsResponse = ApiSuccess<{ sessions: ApiConversation[] }>;

type TFn = ReturnType<typeof useTranslations>;

const DAY_MS = 24 * 60 * 60 * 1000;

function bucketByDate(iso?: string): DateGroup {
  if (!iso) return "older";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "older";
  const now = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  if (t >= todayMs) return "today";
  if (t >= todayMs - DAY_MS) return "yesterday";
  if (t >= now - 7 * DAY_MS) return "week";
  return "older";
}

function formatTime(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

function mapConversation(c: ApiConversation, t: TFn, locale: string): Session {
  const ts = c.updatedAt || c.createdAt;
  return {
    id: c.id,
    title: c.title?.trim() || t("untitledConversation"),
    preview: t("messageCount", { count: c.messageCount ?? 0 }),
    time: formatTime(ts, locale),
    model: c.model || "Auto",
    group: bucketByDate(ts),
  };
}

/* ── 목업 데이터 — 미인증/네트워크 실패 시 폴백 (라벨은 t() 로 렌더 시 해석) ─── */
const MOCK_META: Array<{ id: string; model: string; group: DateGroup }> = [
  { id: "c1", model: "Pro", group: "today" },
  { id: "c2", model: "Default", group: "today" },
  { id: "c3", model: "Fast", group: "yesterday" },
  { id: "c4", model: "Think", group: "yesterday" },
  { id: "c5", model: "Code", group: "week" },
  { id: "c6", model: "Vision", group: "week" },
];

const GROUP_ORDER: DateGroup[] = ["today", "yesterday", "week", "older"];

export default function HistoryPage() {
  const t = useTranslations("history");
  const locale = toBcp47(useLocale());
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setChatHistory, setCurrentSessionId, setArtifacts, clearChat, auth } = useAppStore();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const mockSessions = useMemo<Session[]>(
    () =>
      MOCK_META.map((m) => ({
        ...m,
        title: t(`mock.${m.id}.title`),
        preview: t(`mock.${m.id}.preview`),
        time: t(`mock.${m.id}.time`),
      })),
    [t],
  );
  const [sessions, setSessions] = useState<Session[]>(mockSessions);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // 세션 단건 삭제 — 백엔드 DELETE /api/chat/sessions/:sid (소유자/익명 소유 검증).
  const deleteSession = async (s: Session) => {
    if (!window.confirm(t("deleteConfirm", { title: s.title }))) return;
    try {
      await ApiClient.del(appendAnonSessionId(`/api/chat/sessions/${s.id}`));
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      if (s.id === currentSessionId) clearChat();
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      window.alert(t("deleteError"));
    }
  };

  // 전체 삭제 — 백엔드 DELETE /api/chat/sessions (requireAuth, 로그인 사용자 전용).
  const deleteAll = async () => {
    if (!window.confirm(t("deleteAllConfirm", { count: sessions.length }))) return;
    try {
      await ApiClient.del("/api/chat/sessions");
      setSessions([]);
      clearChat();
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      window.alert(t("deleteAllError"));
    }
  };

  // 대화 클릭 → 해당 세션 메시지 로드 + 채팅 화면으로 전환 (sidebar openSession 과 동일 패턴).
  const openSession = async (sid: string) => {
    setArtifacts([]); // 이전 세션 아티팩트 비움 → 패널이 새 세션 것 재복원
    setCurrentSessionId(sid);
    try {
      const res = await ApiClient.get<
        ApiSuccess<{ messages?: Array<{ role: string; content: string; images?: string[] }> }>
      >(`/api/chat/sessions/${sid}/messages`);
      const msgs = res?.data?.messages ?? [];
      setChatHistory(() =>
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map((m) => ({ role: m.role as ChatRole, content: m.content, images: m.images })),
      );
    } catch {
      /* 조회 실패 — 무시 */
    }
    router.push("/");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<ConversationsResponse>(
          "/api/chat/conversations?limit=100",
        );
        if (cancelled) return;
        const list = res?.data?.sessions ?? [];
        // 실제 데이터가 오면 우선 표시 (빈 배열도 실제 상태로 존중)
        setSessions(list.map((c) => mapConversation(c, t, locale)));
      } catch {
        // 401·네트워크 실패: 목업 폴백 유지 (초기 state 그대로)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // locale/t 변경 시 라벨 재매핑 위해 재조회
  }, [t, locale]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q))
      : sessions;
    return GROUP_ORDER.map((g) => ({
      group: g,
      items: filtered.filter((s) => s.group === g),
    })).filter((g) => g.items.length > 0);
  }, [sessions, query]);

  const isEmpty = grouped.length === 0;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 검색 + 전체 삭제 */}
        <div className="mb-5 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3">
            <Search className="h-4 w-4 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
            />
          </div>
          {auth.currentUser && !loading && sessions.length > 0 && (
            <button
              type="button"
              onClick={() => void deleteAll()}
              className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-muted transition hover:border-danger/40 hover:text-danger"
            >
              <Trash2 className="h-4 w-4" />
              {t("deleteAllButton")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Clock className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </div>
        ) : isEmpty ? (
          <div className="grid place-items-center py-24 text-center">
            <Clock className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">{t("emptyState.title")}</p>
            <p className="mt-1 text-sm text-muted">
              {query ? t("emptyState.noResults") : t("emptyState.hint")}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((g) => (
              <div key={g.group}>
                <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-faint">
                  {t(`group.${g.group}`)}
                </h2>
                <div className="space-y-2">
                  {g.items.map((s) => (
                    <Card
                      key={s.id}
                      onClick={() => void openSession(s.id)}
                      className="group flex cursor-pointer items-start gap-3 p-4 transition hover:border-border-strong hover:shadow-2"
                    >
                      <div className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-surface-2 text-faint">
                        <MessageSquare className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="truncate text-sm font-medium text-fg">
                            {s.title}
                          </h3>
                          <span className="flex-shrink-0 font-mono text-xs text-faint">
                            {s.time}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted">
                          {s.preview}
                        </p>
                        <div className="mt-2">
                          <Badge tone="neutral">
                            <span className="font-mono">{s.model}</span>
                          </Badge>
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={t("deleteAria")}
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteSession(s);
                        }}
                        className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-faint opacity-0 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
