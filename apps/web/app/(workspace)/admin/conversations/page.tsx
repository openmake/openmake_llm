"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MessagesSquare, Search, X, Loader2 } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import { ApiClient } from "@/lib/api-client";
import { toBcp47 } from "@/i18n/config";

/* ── 백엔드 응답 타입 ──────────────────────────────────────────
 * GET /api/chat/conversations?viewAll=true (admin 옵트인) → res.data.sessions (camelCase).
 * 개인 히스토리와 달리 소유자 식별용 userId/anonSessionId 를 함께 사용한다. */
interface ApiConversation {
  id: string;
  title: string | null;
  userId?: string | null;
  anonSessionId?: string | null;
  updatedAt?: string;
  createdAt?: string;
  model?: string;
  messageCount?: number;
}

type ConversationsResponse = ApiSuccess<{ sessions: ApiConversation[] }>;

/* GET /api/agent-tasks?viewAll=true → res.data.tasks (toPublicTask, snake_case). */
interface ApiAgentTask {
  id: string;
  goal: string;
  status: string;
  user_id?: string | null;
  created_at?: string;
}

type AgentTasksResponse = ApiSuccess<{ tasks: ApiAgentTask[] }>;

/* GET /api/research/sessions?viewAll=true → res.data.sessions (snake_case row). */
interface ApiResearchSession {
  id: string;
  topic: string;
  status: string;
  user_id?: string | null;
  created_at?: string;
}

type ResearchListResponse = ApiSuccess<{ sessions: ApiResearchSession[] }>;

interface ApiResearchStep {
  step_number: number;
  step_type: string;
  query?: string | null;
  result?: string | null;
  status?: string | null;
}

type ResearchDetailResponse = ApiSuccess<{
  session?: ApiResearchSession;
  steps?: ApiResearchStep[];
}>;

interface AdminUserLite {
  id: string;
  email: string;
  name?: string;
}

type MessagesResponse = ApiSuccess<{
  messages?: Array<{ role: string; content: string }>;
}>;

type TabKey = "conversations" | "tasks" | "research";

function fmtDateTime(iso: string | undefined, locale: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 작업/리서치 상태 → Badge 색조. 미지정 상태는 neutral. */
function statusTone(status: string): "accent" | "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
      return "danger";
    case "running":
    case "paused":
    case "queued":
    case "pending":
      return "accent";
    default:
      return "neutral";
  }
}

export default function AdminConversationsPage() {
  const t = useTranslations("adminConversations");
  const locale = toBcp47(useLocale());
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("conversations");

  const [sessions, setSessions] = useState<ApiConversation[]>([]);
  const [tasks, setTasks] = useState<ApiAgentTask[]>([]);
  const [research, setResearch] = useState<ApiResearchSession[]>([]);
  const [userMap, setUserMap] = useState<Record<string, AdminUserLite>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // 상세 모달 — 대화(메시지 전문) / 리서치(스텝 전문)
  const [detail, setDetail] = useState<ApiConversation | null>(null);
  const [detailMsgs, setDetailMsgs] = useState<Array<{ role: string; content: string }> | null>(null);
  const [researchDetail, setResearchDetail] = useState<ApiResearchSession | null>(null);
  const [researchSteps, setResearchSteps] = useState<ApiResearchStep[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      // 세 목록(admin 옵트인)과 사용자 목록(이메일 매핑용)을 병렬 조회.
      // 사용자 목록 실패는 허용 — 그 경우 원 userId 로 표시.
      const [convRes, taskRes, researchRes, usersRes] = await Promise.allSettled([
        ApiClient.get<ConversationsResponse>("/api/chat/conversations?viewAll=true&limit=200"),
        ApiClient.get<AgentTasksResponse>("/api/agent-tasks?viewAll=true"),
        ApiClient.get<ResearchListResponse>("/api/research/sessions?viewAll=true"),
        ApiClient.get<ApiSuccess<{ users?: AdminUserLite[] }>>("/api/admin/users?limit=500"),
      ]);
      if (!alive) return;
      if (convRes.status === "fulfilled") {
        setSessions(convRes.value?.data?.sessions ?? []);
      }
      if (taskRes.status === "fulfilled") {
        setTasks(taskRes.value?.data?.tasks ?? []);
      }
      if (researchRes.status === "fulfilled") {
        setResearch(researchRes.value?.data?.sessions ?? []);
      }
      if (usersRes.status === "fulfilled") {
        const users = usersRes.value?.data?.users ?? [];
        setUserMap(Object.fromEntries(users.map((u) => [String(u.id), u])));
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const ownerLabelById = (userId: string | null | undefined): string => {
    if (userId) {
      const u = userMap[String(userId)];
      return u ? u.name || u.email : String(userId);
    }
    return t("guest");
  };

  const ownerLabel = (s: ApiConversation): string => ownerLabelById(s.userId);

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        (s.title ?? "").toLowerCase().includes(q) ||
        ownerLabel(s).toLowerCase().includes(q),
    );
    // ownerLabel 은 userMap 파생 — deps 로 잡는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, query, userMap]);

  const filteredTasks = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t2) =>
        (t2.goal ?? "").toLowerCase().includes(q) ||
        ownerLabelById(t2.user_id).toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, query, userMap]);

  const filteredResearch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return research;
    return research.filter(
      (r) =>
        (r.topic ?? "").toLowerCase().includes(q) ||
        ownerLabelById(r.user_id).toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [research, query, userMap]);

  const activeCount =
    tab === "conversations"
      ? filteredConversations.length
      : tab === "tasks"
        ? filteredTasks.length
        : filteredResearch.length;

  const openDetail = async (s: ApiConversation) => {
    setDetail(s);
    setDetailMsgs(null);
    try {
      const res = await ApiClient.get<MessagesResponse>(
        `/api/chat/sessions/${s.id}/messages?limit=200`,
      );
      setDetailMsgs(res?.data?.messages ?? []);
    } catch {
      setDetailMsgs([]);
    }
  };

  // 리서치 상세: 프론트 /research 페이지는 소유자 목록 전제라 딥링크가 없어, 상세 API
  // (admin 통과)로 스텝을 받아 모달로 표시한다.
  const openResearchDetail = async (r: ApiResearchSession) => {
    setResearchDetail(r);
    setResearchSteps(null);
    try {
      const res = await ApiClient.get<ResearchDetailResponse>(
        `/api/research/sessions/${r.id}`,
      );
      setResearchSteps(res?.data?.steps ?? []);
    } catch {
      setResearchSteps([]);
    }
  };

  const tabDefs: Array<{ key: TabKey; label: string }> = [
    { key: "conversations", label: t("tabs.conversations") },
    { key: "tasks", label: t("tabs.tasks") },
    { key: "research", label: t("tabs.research") },
  ];

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Badge tone="neutral">
            <MessagesSquare className="h-3.5 w-3.5" /> {t("countBadge", { count: activeCount })}
          </Badge>
        }
      />
      <AdminTabs />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border border-border bg-surface p-1">
            {tabDefs.map((d) => (
              <button
                key={d.key}
                onClick={() => setTab(d.key)}
                className={`rounded px-3 py-1.5 text-sm transition ${
                  tab === d.key
                    ? "bg-surface-2 font-medium text-fg"
                    : "text-muted hover:text-fg-2"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-fg-2 outline-none focus:border-border-strong"
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            {tab === "conversations" && (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("th.title")}</Th>
                    <Th>{t("th.owner")}</Th>
                    <Th>{t("th.messages")}</Th>
                    <Th>{t("th.model")}</Th>
                    <Th>{t("th.updatedAt")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <Td className="py-8 text-center text-muted" colSpan={5}>
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </Td>
                    </tr>
                  ) : filteredConversations.length === 0 ? (
                    <tr>
                      <Td className="py-8 text-center text-muted" colSpan={5}>
                        {t("empty")}
                      </Td>
                    </tr>
                  ) : (
                    filteredConversations.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => openDetail(s)}
                        className="cursor-pointer transition hover:bg-surface-2"
                      >
                        <Td className="max-w-[28rem] truncate font-medium text-fg">
                          {s.title?.trim() || t("untitled")}
                        </Td>
                        <Td>
                          {s.userId ? (
                            ownerLabel(s)
                          ) : (
                            <Badge tone="neutral">{t("guest")}</Badge>
                          )}
                        </Td>
                        <Td>{s.messageCount ?? 0}</Td>
                        <Td className="max-w-[12rem] truncate">{s.model || "-"}</Td>
                        <Td>{fmtDateTime(s.updatedAt || s.createdAt, locale)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            )}

            {tab === "tasks" && (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("taskTh.goal")}</Th>
                    <Th>{t("taskTh.owner")}</Th>
                    <Th>{t("taskTh.status")}</Th>
                    <Th>{t("taskTh.createdAt")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <Td className="py-8 text-center text-muted" colSpan={4}>
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </Td>
                    </tr>
                  ) : filteredTasks.length === 0 ? (
                    <tr>
                      <Td className="py-8 text-center text-muted" colSpan={4}>
                        {t("tasksEmpty")}
                      </Td>
                    </tr>
                  ) : (
                    filteredTasks.map((task) => (
                      <tr
                        key={task.id}
                        onClick={() => router.push(`/agent-tasks?task=${task.id}`)}
                        className="cursor-pointer transition hover:bg-surface-2"
                      >
                        <Td className="max-w-[32rem] truncate font-medium text-fg">
                          {task.goal?.trim() || t("untitled")}
                        </Td>
                        <Td>{ownerLabelById(task.user_id)}</Td>
                        <Td>
                          <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                        </Td>
                        <Td>{fmtDateTime(task.created_at, locale)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            )}

            {tab === "research" && (
              <Table>
                <thead>
                  <tr>
                    <Th>{t("researchTh.topic")}</Th>
                    <Th>{t("researchTh.owner")}</Th>
                    <Th>{t("researchTh.status")}</Th>
                    <Th>{t("researchTh.createdAt")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <Td className="py-8 text-center text-muted" colSpan={4}>
                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                      </Td>
                    </tr>
                  ) : filteredResearch.length === 0 ? (
                    <tr>
                      <Td className="py-8 text-center text-muted" colSpan={4}>
                        {t("researchEmpty")}
                      </Td>
                    </tr>
                  ) : (
                    filteredResearch.map((r) => (
                      <tr
                        key={r.id}
                        onClick={() => openResearchDetail(r)}
                        className="cursor-pointer transition hover:bg-surface-2"
                      >
                        <Td className="max-w-[32rem] truncate font-medium text-fg">
                          {r.topic?.trim() || t("untitled")}
                        </Td>
                        <Td>{ownerLabelById(r.user_id)}</Td>
                        <Td>
                          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                        </Td>
                        <Td>{fmtDateTime(r.created_at, locale)}</Td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {detail && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(ev) => { if (ev.target === ev.currentTarget) setDetail(null); }}
        >
          <div className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-surface shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-fg">
                  {detail.title?.trim() || t("untitled")}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {ownerLabel(detail)} · {fmtDateTime(detail.updatedAt || detail.createdAt, locale)}
                </p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="shrink-0 text-faint hover:text-fg"
                aria-label={t("detail.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {detailMsgs === null ? (
                <p className="py-6 text-center text-sm text-muted">{t("detail.loading")}</p>
              ) : detailMsgs.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">{t("detail.empty")}</p>
              ) : (
                detailMsgs.map((m, i) => (
                  <div key={i}>
                    <Badge tone={m.role === "user" ? "success" : "neutral"}>{m.role}</Badge>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-2">
                      {m.content}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {researchDetail && (
        <div
          role="dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(ev) => { if (ev.target === ev.currentTarget) setResearchDetail(null); }}
        >
          <div className="relative mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-surface shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-border p-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-fg">
                  {researchDetail.topic?.trim() || t("untitled")}
                </h2>
                <p className="mt-0.5 text-xs text-muted">
                  {ownerLabelById(researchDetail.user_id)} · {fmtDateTime(researchDetail.created_at, locale)}
                </p>
              </div>
              <button
                onClick={() => setResearchDetail(null)}
                className="shrink-0 text-faint hover:text-fg"
                aria-label={t("detail.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {researchSteps === null ? (
                <p className="py-6 text-center text-sm text-muted">{t("detail.loading")}</p>
              ) : researchSteps.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">{t("researchDetail.empty")}</p>
              ) : (
                researchSteps.map((step, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">
                        {t("researchDetail.step", { n: step.step_number })}
                      </Badge>
                      <span className="text-xs text-muted">{step.step_type}</span>
                    </div>
                    {step.query && (
                      <p className="mt-1 text-sm font-medium text-fg-2">{step.query}</p>
                    )}
                    {step.result && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted">
                        {step.result}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
