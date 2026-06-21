"use client";

import { useEffect, useState } from "react";
import { Sparkles, Plus, Check, LoaderCircle, Clock, Cpu } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 ────────────────────────────────────────────────── */
type TaskStatus = "running" | "completed" | "pending";

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface AgentTask {
  id: string;
  goal: string;
  status: TaskStatus;
  model: string;
  elapsed: string;
  currentTurn: number;
  maxTurns: number;
  progress: number; // 0~100. 체크리스트가 없을 때(실데이터) 진행률 표시용
  checklist: ChecklistItem[];
}

/* ── 백엔드 응답 타입 (GET /api/agent-tasks → res.data.tasks) ── */
interface ApiAgentTask {
  id: string;
  goal: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress?: number;
  current_turn?: number;
  max_turns?: number;
  model?: string;
  created_at?: string;
  completed_at?: string;
}

type AgentTasksResponse = ApiSuccess<{
  tasks: ApiAgentTask[];
  total: number;
}>;

/** failed/cancelled 은 UI 의 3-상태(running/completed/pending)로 축약 — 완료(종료) 취급 */
function mapStatus(s: ApiAgentTask["status"]): TaskStatus {
  if (s === "running") return "running";
  if (s === "completed" || s === "failed" || s === "cancelled") return "completed";
  return "pending";
}

function formatElapsed(start?: string, end?: string): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const sec = Math.round((e - s) / 1000);
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m > 0 ? `${m}분 ${String(r).padStart(2, "0")}초` : `${r}초`;
}

function mapTask(t: ApiAgentTask): AgentTask {
  const status = mapStatus(t.status);
  const progress =
    typeof t.progress === "number"
      ? Math.max(0, Math.min(100, t.progress))
      : status === "completed"
        ? 100
        : 0;
  return {
    id: t.id,
    goal: t.goal,
    status,
    model: t.model || "Auto",
    elapsed: formatElapsed(t.created_at, t.completed_at),
    currentTurn: t.current_turn ?? 0,
    maxTurns: t.max_turns ?? 0,
    progress,
    // 목록 엔드포인트는 스텝(체크리스트)을 포함하지 않음 — 상세(GET /:taskId/steps)에서만 제공.
    checklist: [],
  };
}

/* ── 목업 데이터 — 미인증/네트워크 실패 시 폴백 ─────────────── */
const TASKS: AgentTask[] = [
  {
    id: "t1",
    goal: "최신 AI 에이전트 동향을 조사해서 요약 보고서를 작성",
    status: "running",
    model: "Pro",
    elapsed: "2분 41초",
    currentTurn: 3,
    maxTurns: 8,
    progress: 60,
    checklist: [
      { label: "검색 키워드 도출", done: true },
      { label: "웹 검색 수행", done: true },
      { label: "핵심 소스 정리", done: true },
      { label: "요약 초안 작성", done: false },
      { label: "최종 검토", done: false },
    ],
  },
  {
    id: "t2",
    goal: "사내 위키 문서를 정리하고 누락된 섹션 목록 생성",
    status: "completed",
    model: "Default",
    elapsed: "5분 08초",
    currentTurn: 6,
    maxTurns: 6,
    progress: 100,
    checklist: [
      { label: "문서 인덱싱", done: true },
      { label: "섹션 구조 분석", done: true },
      { label: "누락 항목 식별", done: true },
      { label: "리포트 생성", done: true },
    ],
  },
  {
    id: "t3",
    goal: "경쟁사 가격 정책을 수집해 비교표로 정리",
    status: "pending",
    model: "Fast",
    elapsed: "—",
    currentTurn: 0,
    maxTurns: 5,
    progress: 0,
    checklist: [
      { label: "대상 경쟁사 선정", done: false },
      { label: "가격 데이터 수집", done: false },
      { label: "비교표 구성", done: false },
    ],
  },
];

const STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "accent" | "success" | "neutral" }
> = {
  running: { label: "진행중", tone: "accent" },
  completed: { label: "완료", tone: "success" },
  pending: { label: "대기", tone: "neutral" },
};

export default function AgentTasksPage() {
  const [tasks, setTasks] = useState<AgentTask[]>(TASKS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<AgentTasksResponse>("/api/agent-tasks");
        if (cancelled) return;
        setTasks((res?.data?.tasks ?? []).map(mapTask));
      } catch {
        // 401·네트워크 실패: 목업 폴백 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="에이전트 작업"
        description="자율 에이전트가 목표 달성까지 다단계로 작업을 수행합니다."
        actions={
          <Button size="sm">
            <Plus className="h-4 w-4" />새 작업
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">작업이 없습니다</p>
            <p className="mt-1 text-sm text-muted">
              목표를 입력하고 새 작업을 시작하세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => {
              const meta = STATUS_META[task.status];
              const total = task.checklist.length;
              const completed = task.checklist.filter((c) => c.done).length;
              // 체크리스트가 있으면(목업) 그 비율, 없으면(실데이터) progress 사용
              const pct = total
                ? Math.round((completed / total) * 100)
                : task.progress;
              return (
                <Card key={task.id} className="flex flex-col p-5">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <Badge tone={meta.tone}>
                      {task.status === "running" && (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      )}
                      {meta.label}
                    </Badge>
                    <span className="font-mono text-xs text-faint">
                      턴 {task.currentTurn}/{task.maxTurns}
                    </span>
                  </div>

                  <h3 className="mb-4 line-clamp-2 text-sm font-semibold leading-snug text-fg">
                    {task.goal}
                  </h3>

                  {/* 진행 체크리스트 (목업/상세에만 존재 — 목록 실데이터는 비어 있음) */}
                  {total > 0 ? (
                    <ul className="mb-4 flex-1 space-y-1.5">
                      {task.checklist.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 text-xs"
                        >
                          <span
                            className={cn(
                              "grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border",
                              item.done
                                ? "border-success bg-success-soft text-success"
                                : "border-border text-faint",
                            )}
                          >
                            {item.done && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span
                            className={cn(
                              item.done
                                ? "text-fg-2 line-through decoration-faint"
                                : "text-muted",
                            )}
                          >
                            {item.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex-1" />
                  )}

                  {/* 프로그레스 바 */}
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-faint">진행률</span>
                      <span className="font-mono text-fg-2">{pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
                      <div
                        className="h-full rounded-pill bg-accent transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  {/* 메타 */}
                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-faint">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {task.elapsed}
                    </span>
                    <span className="flex items-center gap-1">
                      <Cpu className="h-3.5 w-3.5" />
                      {task.model}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
