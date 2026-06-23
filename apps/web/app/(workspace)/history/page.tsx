"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Search, MessageSquare } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Badge, PageHeader, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
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

function formatTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

function mapConversation(c: ApiConversation): Session {
  const ts = c.updatedAt || c.createdAt;
  return {
    id: c.id,
    title: c.title?.trim() || "제목 없는 대화",
    preview: `메시지 ${c.messageCount ?? 0}개`,
    time: formatTime(ts),
    model: c.model || "Auto",
    group: bucketByDate(ts),
  };
}

/* ── 목업 데이터 — 미인증/네트워크 실패 시 폴백 ─────────────── */
const SESSIONS: Session[] = [
  {
    id: "c1",
    title: "Next.js 16 App Router 마이그레이션",
    preview: "기존 pages 라우터에서 app 라우터로 옮길 때 주의할 점은...",
    time: "오후 2:14",
    model: "Pro",
    group: "today",
  },
  {
    id: "c2",
    title: "PostgreSQL 인덱스 튜닝",
    preview: "복합 인덱스 순서가 쿼리 플랜에 미치는 영향을 설명해줘",
    time: "오전 11:02",
    model: "Default",
    group: "today",
  },
  {
    id: "c3",
    title: "마케팅 캠페인 카피 브레인스토밍",
    preview: "20대 타겟의 SNS 광고 카피 5개 변형을 만들어줘",
    time: "오후 6:47",
    model: "Fast",
    group: "yesterday",
  },
  {
    id: "c4",
    title: "리서치 보고서 구조 잡기",
    preview: "엔터프라이즈 LLM 도입 보고서의 목차를 제안해줘",
    time: "오후 3:20",
    model: "Think",
    group: "yesterday",
  },
  {
    id: "c5",
    title: "TypeScript 제네릭 타입 가드",
    preview: "Discriminated union 을 안전하게 좁히는 방법은?",
    time: "월요일",
    model: "Code",
    group: "week",
  },
  {
    id: "c6",
    title: "이미지 분석 프롬프트",
    preview: "첨부한 차트에서 주요 트렌드를 읽어줘",
    time: "일요일",
    model: "Vision",
    group: "week",
  },
];

const GROUP_LABEL: Record<DateGroup, string> = {
  today: "오늘",
  yesterday: "어제",
  week: "이번 주",
  older: "이전",
};

const GROUP_ORDER: DateGroup[] = ["today", "yesterday", "week", "older"];

export default function HistoryPage() {
  const router = useRouter();
  const { setChatHistory, setCurrentSessionId, setArtifacts } = useAppStore();
  const [sessions, setSessions] = useState<Session[]>(SESSIONS);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

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
        setSessions(list.map(mapConversation));
      } catch {
        // 401·네트워크 실패: 목업 폴백 유지 (초기 state 그대로)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? sessions.filter((s) => s.title.toLowerCase().includes(q))
      : sessions;
    return GROUP_ORDER.map((g) => ({
      group: g,
      label: GROUP_LABEL[g],
      items: filtered.filter((s) => s.group === g),
    })).filter((g) => g.items.length > 0);
  }, [sessions, query]);

  const isEmpty = grouped.length === 0;

  return (
    <>
      <PageHeader
        title="대화 히스토리"
        description="이전 대화를 검색하고 이어서 진행할 수 있습니다."
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 검색 */}
        <div className="mb-5 flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="대화 제목 검색..."
            className="h-9 w-full bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          />
        </div>

        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Clock className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : isEmpty ? (
          <div className="grid place-items-center py-24 text-center">
            <Clock className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">대화 기록이 없습니다</p>
            <p className="mt-1 text-sm text-muted">
              {query
                ? "검색 결과가 없습니다."
                : "새 대화를 시작하면 여기에 표시됩니다."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((g) => (
              <div key={g.group}>
                <h2 className="mb-2 font-mono text-xs uppercase tracking-wide text-faint">
                  {g.label}
                </h2>
                <div className="space-y-2">
                  {g.items.map((s) => (
                    <Card
                      key={s.id}
                      onClick={() => void openSession(s.id)}
                      className="flex cursor-pointer items-start gap-3 p-4 transition hover:border-border-strong hover:shadow-2"
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
