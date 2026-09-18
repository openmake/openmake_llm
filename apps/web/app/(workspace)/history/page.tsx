"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Search, MessageSquare, Trash2, Bot, Users, FolderInput, Folder, Tag } from "lucide-react";
import type { ApiSuccess, ConversationFolder, SearchSourceRef } from "@openmake/shared-types";
import { Badge, PageHeader, Card } from "@/components/ui/primitives";
import { HistoryTabs } from "@/components/hub-tabs";
import { ApiClient } from "@/lib/api-client";
import { toBcp47 } from "@/i18n/config";
import { appendAnonSessionId } from "@/lib/anon-session";
import { useAppStore } from "@/lib/store";
import type { ChatRole } from "@/lib/store";
import { FolderRail, type HistoryFilter } from "@/components/history/folder-rail";
import { SessionOrganizeDialog } from "@/components/history/session-organize-dialog";

/* ── 타입 ────────────────────────────────────────────────── */
type DateGroup = "today" | "yesterday" | "week" | "older";

interface Session {
  id: string;
  /** 'chat' = 대화 세션, 'task' = 에이전트 작업(읽기 전용 항목 — 클릭 시 작업 상세로 이동) */
  kind: "chat" | "task";
  title: string;
  preview: string;
  time: string;
  /** 그룹 내 최신순 정렬용 epoch ms */
  ts: number;
  model: string;
  group: DateGroup;
  /** kind='task' 전용 — chat.status.* 라벨 키 */
  status?: string;
  /** 소유자 id — admin 전체 보기(viewAll)에서 타 사용자 항목 구분용 */
  ownerId?: string;
  /** 폴더·태그(157) — chat 전용 */
  folderId?: string | null;
  tags?: string[];
}

/* ── 백엔드 응답 타입 (GET /api/chat/conversations → res.data.sessions, camelCase) ──
 * 이 엔드포인트는 camelCase(updatedAt/createdAt) 로 응답하므로 shared-types
 * ConversationSession(snake_case) 과 형태가 달라 로컬 계약을 유지한다. envelope 만 shared 로. */
interface ApiConversation {
  id: string;
  title: string | null;
  userId?: string | number | null;
  updatedAt?: string;
  createdAt?: string;
  model?: string;
  messageCount?: number;
  /** ?q= 본문 검색 시 매칭 메시지 발췌 (비검색 응답엔 없음) */
  snippet?: string;
  folderId?: string | null;
  tags?: string[];
}

type ConversationsResponse = ApiSuccess<{ sessions: ApiConversation[] }>;

/* ── 에이전트 작업 목록 (GET /api/agent-tasks → res.data.tasks, snake_case — toPublicTask 메타만) ── */
interface ApiAgentTask {
  id: string;
  goal: string;
  status: string;
  model?: string | null;
  created_at?: string;
  updated_at?: string;
  user_id?: string | number;
}

type AgentTasksResponse = ApiSuccess<{ tasks: ApiAgentTask[] }>;

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

function toEpoch(iso?: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function mapConversation(c: ApiConversation, t: TFn, locale: string): Session {
  const ts = c.updatedAt || c.createdAt;
  return {
    id: c.id,
    kind: "chat",
    title: c.title?.trim() || t("untitledConversation"),
    preview: t("messageCount", { count: c.messageCount ?? 0 }),
    time: formatTime(ts, locale),
    ts: toEpoch(ts),
    model: c.model || "Auto",
    group: bucketByDate(ts),
    ownerId: c.userId != null ? String(c.userId) : undefined,
    folderId: c.folderId ?? null,
    tags: c.tags ?? [],
  };
}

/** PURE: 현재 목록의 태그를 많이 쓰인 순으로 */
function collectTags(items: Session[]): string[] {
  const counts = new Map<string, number>();
  for (const s of items) for (const tag of s.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

function filterQuery(f: HistoryFilter): string {
  return `${f.folderId ? `&folderId=${encodeURIComponent(f.folderId)}` : ""}${f.tag ? `&tag=${encodeURIComponent(f.tag)}` : ""}`;
}

/** chat.status.* 에 라벨이 있는 상태만 t() — 그 외(queued 등)는 원문 표시(누락 키 경고 방지) */
const LABELED_TASK_STATUS = new Set(["pending", "running", "paused", "completed", "failed", "cancelled"]);

function mapAgentTask(a: ApiAgentTask, tChat: TFn, locale: string): Session {
  const ts = a.updated_at || a.created_at;
  return {
    id: a.id,
    kind: "task",
    title: a.goal.trim(),
    preview: LABELED_TASK_STATUS.has(a.status) ? tChat(`status.${a.status}`) : a.status,
    time: formatTime(ts, locale),
    ts: toEpoch(ts),
    model: a.model || "Auto",
    group: bucketByDate(ts),
    status: a.status,
    ownerId: a.user_id != null ? String(a.user_id) : undefined,
  };
}

const GROUP_ORDER: DateGroup[] = ["today", "yesterday", "week", "older"];

export default function HistoryPage() {
  const t = useTranslations("history");
  const tChat = useTranslations("chat"); // 작업 상태·"에이전트 작업" 라벨 재사용 (nav 라벨 재사용 관행)
  const locale = toBcp47(useLocale());
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setChatHistory, setCurrentSessionId, setArtifacts, clearChat, auth } = useAppStore();
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  // 실데이터만 — 그전엔 폐기된 brand profile(Pro/Think/Vision) 이름을 단 목업 6건이 401 시 실렌더됐다
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // admin 전체 보기 — 대화·작업 목록 모두 ?viewAll=true 로 조회(비관리자는 서버가 무시).
  // 시스템 관리자 모니터링 용도 (agent-tasks 페이지 토글과 동일 관용구).
  const isAdmin = auth.currentUser?.role === "admin";
  const myUserId = auth.currentUser?.id;
  const [viewAll, setViewAll] = useState(false);
  // 폴더·태그(157) — 로그인 사용자 본인 목록에서만(전체 보기·게스트 제외)
  const canOrganize = !!auth.currentUser && !viewAll;
  const [folders, setFolders] = useState<ConversationFolder[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>({});
  const [allTags, setAllTags] = useState<string[]>([]);
  const [organizing, setOrganizing] = useState<Session | null>(null);
  const filterActive = !!(filter.folderId || filter.tag);

  const loadFolders = async () => {
    try {
      const r = await ApiClient.get<ApiSuccess<{ folders: ConversationFolder[] }>>("/api/chat/folders");
      setFolders(r?.data?.folders ?? []);
    } catch {
      setFolders([]);
    }
  };
  useEffect(() => {
    if (canOrganize) void loadFolders();
    else { setFolders([]); setFilter({}); }
  }, [canOrganize]);

  const createFolder = async (name: string) => {
    await ApiClient.post("/api/chat/folders", { name });
    await loadFolders();
  };
  const renameFolder = async (id: string, name: string) => {
    await ApiClient.patch(`/api/chat/folders/${encodeURIComponent(id)}`, { name });
    await loadFolders();
  };
  const removeFolder = async (f: ConversationFolder) => {
    if (!window.confirm(t("folders.deleteConfirm", { name: f.name }))) return;
    await ApiClient.del(`/api/chat/folders/${encodeURIComponent(f.id)}`);
    if (filter.folderId === f.id) setFilter({ ...filter, folderId: undefined });
    setSessions((prev) => prev.map((s) => (s.folderId === f.id ? { ...s, folderId: null } : s)));
    await loadFolders();
  };
  const saveOrganization = async (s: Session, patch: { folderId: string | null; tags: string[] }) => {
    const r = await ApiClient.patch<ApiSuccess<{ folderId: string | null; tags: string[] }>>(appendAnonSessionId(`/api/chat/sessions/${s.id}`), patch);
    const next = { folderId: r?.data?.folderId ?? patch.folderId, tags: r?.data?.tags ?? patch.tags };
    // 필터에서 벗어나면 목록에서 뺀다(서버 필터와 같은 규칙)
    setSessions((prev) => prev
      .map((x) => (x.kind === "chat" && x.id === s.id ? { ...x, ...next } : x))
      .filter((x) => x.kind !== "chat" || x.id !== s.id
        || ((filter.folderId === undefined || (filter.folderId === "none" ? !next.folderId : next.folderId === filter.folderId))
          && (!filter.tag || next.tags.includes(filter.tag)))));
    setAllTags((prev) => [...new Set([...next.tags, ...prev])]);
    await loadFolders();
  };

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
  // 대화만 삭제한다 — 작업 항목은 read-only 표시이므로 유지(삭제는 작업 페이지에서).
  const chatCount = sessions.filter((s) => s.kind === "chat").length;
  const deleteAll = async () => {
    if (!window.confirm(t("deleteAllConfirm", { count: chatCount }))) return;
    try {
      await ApiClient.del("/api/chat/sessions");
      setSessions((prev) => prev.filter((s) => s.kind === "task"));
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
    // 노트북 컨텍스트는 대화 스코프 — 다른 대화로 누수 방지 (sidebar openSession 과 동일)
    useAppStore.getState().clearContextRefs();
    try {
      const res = await ApiClient.get<
        ApiSuccess<{ messages?: Array<{ role: string; content: string; images?: string[]; sources?: SearchSourceRef[] }> }>
      >(appendAnonSessionId(`/api/chat/sessions/${sid}/messages`));
      const msgs = res?.data?.messages ?? [];
      setChatHistory(() =>
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map((m) => ({ role: m.role as ChatRole, content: m.content, images: m.images, ...(m.sources?.length ? { sources: m.sources } : {}) })),
      );
    } catch {
      /* 조회 실패 — 무시 */
    }
    router.push("/");
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 대화·에이전트 작업을 병렬 조회해 한 목록으로 합친다(B 방식 — 데이터 이동 없는 read-only 조합).
      // 각각 개별 실패 허용: 작업 API 는 익명 401 이 정상이므로 빈 배열 폴백.
      const [convRes, taskRes] = await Promise.allSettled([
        ApiClient.get<ConversationsResponse>(
          appendAnonSessionId(`/api/chat/conversations?limit=100${viewAll ? "&viewAll=true" : filterQuery(filter)}`),
        ),
        // 폴더·태그 필터 중엔 작업 항목을 섞지 않는다(작업에는 폴더·태그가 없다)
        filterActive ? Promise.resolve({ data: { tasks: [] } } as unknown as AgentTasksResponse) : ApiClient.get<AgentTasksResponse>(viewAll ? "/api/agent-tasks?viewAll=true" : "/api/agent-tasks"),
      ]);
      if (cancelled) return;
      const convs = convRes.status === "fulfilled" ? (convRes.value?.data?.sessions ?? []) : null;
      const taskItems = taskRes.status === "fulfilled" ? (taskRes.value?.data?.tasks ?? []) : [];
      if (convs !== null || taskItems.length > 0) {
        // 실제 데이터가 오면 우선 표시 (빈 배열도 실제 상태로 존중)
        const mapped = [
          ...(convs ?? []).map((c) => mapConversation(c, t, locale)),
          ...taskItems.map((a) => mapAgentTask(a, tChat, locale)),
        ];
        setSessions(mapped);
        // 태그 칩은 필터 없는 전체 목록 기준으로 모은다(필터 중엔 이전 목록 유지)
        if (!filterActive) setAllTags(collectTags(mapped));
      }
      // 둘 다 실패(401·네트워크): 빈 상태 유지
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // locale/t 변경 시 라벨 재매핑 위해 재조회, viewAll 토글·폴더/태그 필터 변경 시 범위 재조회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tChat, locale, viewAll, filter.folderId, filter.tag]);

  // 본문 검색 — 서버 ?q= (제목+메시지 ILIKE). 제목 클라 필터에 매칭 세션 id 를 합류시키고,
  // 메인 목록(limit=100) 밖의 매칭 세션은 별도(searchExtras)로 목록에 병합한다.
  // 2자 미만은 클라 제목 필터만(왕복 절약), 실패 시에도 제목 필터는 유지되므로 fail-open.
  const [bodyHits, setBodyHits] = useState<Record<string, string | null>>({});
  const [searchExtras, setSearchExtras] = useState<Session[]>([]);
  useEffect(() => {
    // 검색어가 바뀌면 이전 검색 결과를 즉시 무효화 — stale 매칭이 debounce 동안 잔존 방지
    setBodyHits({});
    setSearchExtras([]);
    const q = query.trim();
    if (q.length < 2) return;
    // 전체 보기(admin viewAll)에선 서버 본문 검색이 user/anon 스코프 전용이라 미지원 —
    // 클라 제목 필터만 동작한다.
    if (viewAll) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await ApiClient.get<ConversationsResponse>(
          appendAnonSessionId(`/api/chat/conversations?limit=100&q=${encodeURIComponent(q)}${filterQuery(filter)}`),
        );
        if (cancelled) return;
        const list = res?.data?.sessions ?? [];
        const hits: Record<string, string | null> = {};
        for (const s of list) hits[s.id] = s.snippet ?? null;
        setBodyHits(hits);
        setSearchExtras(list.map((c) => mapConversation(c, t, locale)));
      } catch {
        /* 검색 실패 — 제목 필터만 동작 */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, t, locale, viewAll, filter.folderId, filter.tag]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? [
          ...sessions.filter(
            (s) => s.title.toLowerCase().includes(q) || (s.kind === "chat" && s.id in bodyHits),
          ),
          // 메인 목록(상위 100) 밖에서 본문 매칭된 오래된 세션 병합 (중복 제외)
          ...searchExtras.filter(
            (s) => !sessions.some((x) => x.kind === "chat" && x.id === s.id),
          ),
        ]
      : sessions;
    return GROUP_ORDER.map((g) => ({
      group: g,
      // 대화·작업이 각각 API 순서로 합쳐지므로 그룹 안에서 최신순 재정렬
      items: filtered.filter((s) => s.group === g).sort((a, b) => b.ts - a.ts),
    })).filter((g) => g.items.length > 0);
  }, [sessions, query, bodyHits, searchExtras]);

  const isEmpty = grouped.length === 0;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <HistoryTabs />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {canOrganize && (
        <aside className="max-h-48 flex-shrink-0 overflow-y-auto border-b border-border p-4 md:max-h-none md:w-56 md:border-b-0 md:border-r">
          <FolderRail
            folders={folders}
            tags={allTags}
            filter={filter}
            onFilter={setFilter}
            onCreate={createFolder}
            onRename={renameFolder}
            onDelete={removeFolder}
          />
        </aside>
      )}
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
          {isAdmin && (
            <button
              type="button"
              onClick={() => setViewAll((v) => !v)}
              className={`flex h-9 flex-shrink-0 items-center gap-1.5 rounded-md border px-3 text-sm transition ${
                viewAll
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border-strong bg-surface-2 text-muted hover:text-fg"
              }`}
            >
              <Users className="h-4 w-4" />
              {t("viewAllToggle")}
            </button>
          )}
          {auth.currentUser && !loading && chatCount > 0 && (
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
                      key={`${s.kind}-${s.id}`}
                      onClick={() =>
                        s.kind === "task"
                          ? router.push(`/agent-tasks?task=${s.id}`)
                          : void openSession(s.id)
                      }
                      className="group flex cursor-pointer items-start gap-3 p-4 transition hover:border-border-strong hover:shadow-2"
                    >
                      <div className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md bg-surface-2 text-faint">
                        {s.kind === "task" ? <Bot className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
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
                          {s.kind === "chat" && bodyHits[s.id] ? bodyHits[s.id] : s.preview}
                        </p>
                        <div className="mt-2 flex items-center gap-1.5">
                          {s.kind === "task" && (
                            <Badge tone={s.status === "failed" ? "danger" : "accent"}>
                              {tChat("agentTask.title")}
                            </Badge>
                          )}
                          <Badge tone="neutral">
                            <span className="font-mono">{s.model}</span>
                          </Badge>
                          {s.kind === "chat" && s.folderId && (
                            <Badge tone="neutral">
                              <Folder className="mr-1 inline h-3 w-3" aria-hidden />
                              {folders.find((f) => f.id === s.folderId)?.name ?? t("folders.folderBadge")}
                            </Badge>
                          )}
                          {s.kind === "chat" && (s.tags ?? []).map((tag) => (
                            <Badge key={tag} tone="neutral">
                              <Tag className="mr-1 inline h-3 w-3" aria-hidden />
                              {tag}
                            </Badge>
                          ))}
                          {/* 전체 보기에서 타 사용자 항목 구분 */}
                          {viewAll && s.ownerId && s.ownerId !== String(myUserId ?? "") && (
                            <Badge tone="accent">{t("ownerBadge", { id: s.ownerId })}</Badge>
                          )}
                        </div>
                      </div>
                      {s.kind === "chat" && canOrganize && (
                        <button
                          type="button"
                          aria-label={t("folders.organizeAria", { title: s.title })}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOrganizing(s);
                          }}
                          className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-md text-faint opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-3 hover:text-fg"
                        >
                          <FolderInput className="h-4 w-4" />
                        </button>
                      )}
                      {s.kind === "chat" && (
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
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      <SessionOrganizeDialog
        open={!!organizing}
        title={organizing?.title ?? ""}
        folders={folders}
        initialFolderId={organizing?.folderId ?? null}
        initialTags={organizing?.tags ?? EMPTY_TAGS}
        onClose={() => setOrganizing(null)}
        onSave={(patch) => (organizing ? saveOrganization(organizing, patch) : Promise.resolve())}
      />
    </>
  );
}

const EMPTY_TAGS: string[] = [];
