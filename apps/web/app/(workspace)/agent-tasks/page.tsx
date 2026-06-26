"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  Plus,
  Check,
  LoaderCircle,
  Clock,
  Cpu,
  X,
  Trash2,
  Play,
  RotateCcw,
  ChevronRight,
} from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 ────────────────────────────────────────────────── */
type TaskStatus = "running" | "completed" | "pending";
type ApiTaskStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface AgentTask {
  id: string;
  goal: string;
  status: TaskStatus;
  rawStatus: ApiTaskStatus;
  model: string;
  elapsed: string;
  currentTurn: number;
  maxTurns: number;
  progress: number;
  checklist: ChecklistItem[];
  resumable?: boolean;
}

interface ApiAgentTask {
  id: string;
  goal: string;
  status: ApiTaskStatus;
  progress?: number;
  current_turn?: number;
  max_turns?: number;
  model?: string;
  created_at?: string;
  completed_at?: string;
  resumable?: boolean;
}

interface ApiTaskStep {
  id: string;
  turn: number;
  type?: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  created_at?: string;
}

type AgentTasksResponse = ApiSuccess<{ tasks: ApiAgentTask[]; total: number }>;
type AgentTaskDetailResponse = ApiSuccess<{ task: ApiAgentTask; steps: ApiTaskStep[] }>;

/* ── 유틸 ────────────────────────────────────────────────── */
function mapStatus(s: ApiTaskStatus): TaskStatus {
  if (s === "running" || s === "paused") return "running";
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
    rawStatus: t.status,
    model: t.model || "Auto",
    elapsed: formatElapsed(t.created_at, t.completed_at),
    currentTurn: t.current_turn ?? 0,
    maxTurns: t.max_turns ?? 0,
    progress,
    checklist: [],
    resumable: t.resumable,
  };
}

/* ── 목업 폴백 ─────────────────────────────────────────────── */
const TASK_FALLBACK: AgentTask[] = [
  {
    id: "t1",
    goal: "최신 AI 에이전트 동향을 조사해서 요약 보고서를 작성",
    status: "running",
    rawStatus: "running",
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
    rawStatus: "completed",
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
    rawStatus: "pending",
    model: "Fast",
    elapsed: "—",
    currentTurn: 0,
    maxTurns: 5,
    progress: 0,
    checklist: [],
  },
];

const STATUS_META: Record<TaskStatus, { label: string; tone: "accent" | "success" | "neutral" }> = {
  running: { label: "진행중", tone: "accent" },
  completed: { label: "완료", tone: "success" },
  pending: { label: "대기", tone: "neutral" },
};

/* ── 오버레이 모달 ────────────────────────────────────────── */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto mx-4 rounded-lg border border-border bg-app shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── 작업 생성 폼 ─────────────────────────────────────────── */
function CreateTaskForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (taskId: string) => void | Promise<void>;
}) {
  const [goal, setGoal] = useState("");
  const [maxTurns, setMaxTurns] = useState(8);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!goal.trim()) { setFormError("목표를 입력하세요."); return; }
    setSaving(true);
    setFormError(null);
    try {
      const res = await ApiClient.post<ApiSuccess<{ task: ApiAgentTask }>>("/api/agent-tasks", {
        goal: goal.trim(),
        maxTurns,
      });
      const taskId = res?.data?.task?.id;
      if (!taskId) throw new Error("taskId가 응답에 없습니다");
      await onCreated(taskId);
    } catch (err) {
      setFormError("생성 실패: " + (err instanceof Error ? err.message : "서버 오류"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">에이전트 목표 *</span>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)}
          rows={4} autoFocus
          placeholder="예: 최신 AI 에이전트 동향을 조사해서 요약 보고서를 작성해줘"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">최대 턴 수</span>
        <input type="number" value={maxTurns} onChange={(e) => setMaxTurns(Number(e.target.value))}
          min={1} max={50}
          className="h-9 w-32 rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>취소</Button>
        <Button type="submit" disabled={saving}>
          {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          생성 및 실행
        </Button>
      </div>
    </form>
  );
}

/* ── 작업 상세 모달 (스텝 타임라인) ─────────────────────── */
function TaskDetailModal({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<{ task: ApiAgentTask; steps: ApiTaskStep[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<AgentTaskDetailResponse>(`/api/agent-tasks/${taskId}`);
        if (!cancelled) setDetail(res?.data ?? null);
      } catch {
        // 오류 시 detail = null
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center text-muted text-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          불러오는 중...
        </div>
      ) : !detail ? (
        <p className="text-sm text-danger py-8 text-center">작업 정보를 불러오지 못했습니다.</p>
      ) : (
        <>
          <div className="rounded-md border border-border bg-surface-2 p-4">
            <p className="mb-1 text-xs font-medium text-muted">목표</p>
            <p className="text-sm text-fg">{detail.task.goal}</p>
            <div className="mt-2 flex gap-3 text-xs text-faint">
              <span>상태: {detail.task.status}</span>
              <span>턴: {detail.task.current_turn ?? 0}/{detail.task.max_turns ?? 0}</span>
            </div>
          </div>

          {detail.steps.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">스텝 기록이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-fg-2">실행 스텝 ({detail.steps.length})</p>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                {detail.steps.map((step, i) => (
                  <div key={step.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-mono",
                        "border-border bg-surface-2 text-faint",
                      )}>
                        {i + 1}
                      </div>
                      {i < detail.steps.length - 1 && (
                        <div className="w-px flex-1 bg-border mt-1" />
                      )}
                    </div>
                    <div className="pb-3 min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs text-muted mb-0.5">
                        <Badge tone="neutral">{step.type ?? "step"}</Badge>
                        {step.tool_name && <span className="font-mono">{step.tool_name}</span>}
                      </div>
                      {step.content && (
                        <p className="text-xs text-fg-2 line-clamp-3 leading-relaxed">
                          {step.content}
                        </p>
                      )}
                      {step.tool_output && (
                        <p className="mt-1 text-xs text-muted font-mono line-clamp-2 bg-surface-2 rounded px-2 py-1">
                          {step.tool_output}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── 메인 페이지 ──────────────────────────────────────────── */
/* ── 승인 대기 패널 (HITL 게이트) ──────────────────────────── */
interface PendingApproval {
  approvalId: string;
  taskId: string;
  toolName: string;
  args: Record<string, unknown>;
}
type ApprovalsResponse = ApiSuccess<{ pending: PendingApproval[] }>;

function ApprovalsPanel() {
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApprovalsResponse>("/api/agent-tasks/approvals/pending");
      setPending(res?.data?.pending ?? []);
    } catch {
      // 401·네트워크: 빈 목록 유지
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  async function decide(approvalId: string, decision: "approve" | "reject") {
    setBusy(approvalId);
    try {
      await ApiClient.post(`/api/agent-tasks/approvals/${approvalId}/${decision}`, {});
      await load();
    } catch (err) {
      alert("처리 실패: " + (err instanceof Error ? err.message : "오류"));
    } finally {
      setBusy(null);
    }
  }

  if (pending.length === 0) return null;

  return (
    <Card className="mb-4 p-4">
      <p className="mb-3 text-sm font-medium text-fg-2">
        승인 대기 중인 도구 실행 ({pending.length})
      </p>
      <div className="space-y-2">
        {pending.map((p) => (
          <div
            key={p.approvalId}
            className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg-1 p-2"
          >
            <div className="min-w-0">
              <span className="font-mono text-xs text-fg-2">{p.toolName}</span>
              <span className="ml-2 break-all text-xs text-muted">
                {JSON.stringify(p.args).slice(0, 100)}
              </span>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === p.approvalId}
                onClick={() => decide(p.approvalId, "reject")}
              >
                거절
              </Button>
              <Button
                size="sm"
                disabled={busy === p.approvalId}
                onClick={() => decide(p.approvalId, "approve")}
              >
                승인
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AgentTasksPage() {
  const [tasks, setTasks] = useState<AgentTask[]>(TASK_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // taskId being acted on

  const loadTasks = useCallback(async () => {
    try {
      const res = await ApiClient.get<AgentTasksResponse>("/api/agent-tasks");
      setTasks((res?.data?.tasks ?? []).map(mapTask));
    } catch {
      // 401·네트워크 실패: 목업 폴백 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadTasks();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadTasks]);

  async function handleCreated(taskId: string) {
    setShowCreate(false);
    // 생성 후 즉시 실행
    try {
      await ApiClient.post(`/api/agent-tasks/${taskId}/execute`, {});
    } catch {
      // execute 실패해도 목록 새로고침
    }
    await loadTasks();
  }

  async function handleCancel(task: AgentTask) {
    if (!window.confirm(`"${task.goal.slice(0, 40)}..." 작업을 취소하시겠습니까?`)) return;
    setActionLoading(task.id);
    try {
      await ApiClient.post(`/api/agent-tasks/${task.id}/cancel`, {});
      await loadTasks();
    } catch (err) {
      alert("취소 실패: " + (err instanceof Error ? err.message : "오류"));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResume(task: AgentTask) {
    setActionLoading(task.id);
    try {
      await ApiClient.post(`/api/agent-tasks/${task.id}/resume`, {});
      await loadTasks();
    } catch (err) {
      alert("이어하기 실패: " + (err instanceof Error ? err.message : "오류"));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(task: AgentTask) {
    if (!window.confirm(`"${task.goal.slice(0, 40)}..." 작업을 삭제하시겠습니까?`)) return;
    setActionLoading(task.id);
    try {
      await ApiClient.del(`/api/agent-tasks/${task.id}`);
      await loadTasks();
    } catch (err) {
      alert("삭제 실패: " + (err instanceof Error ? err.message : "오류"));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <>
      <PageHeader
        title="에이전트 작업"
        description="자율 에이전트가 목표 달성까지 다단계로 작업을 수행합니다."
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />새 작업
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <ApprovalsPanel />
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">작업이 없습니다</p>
            <p className="mt-1 text-sm text-muted">목표를 입력하고 새 작업을 시작하세요.</p>
            <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />새 작업 만들기
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => {
              const meta = STATUS_META[task.status];
              const total = task.checklist.length;
              const completed = task.checklist.filter((c) => c.done).length;
              const pct = total ? Math.round((completed / total) * 100) : task.progress;
              const isActing = actionLoading === task.id;

              return (
                <Card key={task.id} className="flex flex-col p-5">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <Badge tone={meta.tone}>
                      {task.status === "running" && (
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                      )}
                      {meta.label}
                      {task.rawStatus === "failed" && " (실패)"}
                      {task.rawStatus === "cancelled" && " (취소됨)"}
                    </Badge>
                    <span className="font-mono text-xs text-faint">
                      턴 {task.currentTurn}/{task.maxTurns}
                    </span>
                  </div>

                  <h3
                    className="mb-4 line-clamp-2 cursor-pointer text-sm font-semibold leading-snug text-fg hover:underline"
                    onClick={() => setDetailTaskId(task.id)}
                  >
                    {task.goal}
                  </h3>

                  {total > 0 ? (
                    <ul className="mb-4 flex-1 space-y-1.5">
                      {task.checklist.map((item, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <span className={cn(
                            "grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border",
                            item.done ? "border-success bg-success-soft text-success" : "border-border text-faint",
                          )}>
                            {item.done && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className={cn(item.done ? "text-fg-2 line-through decoration-faint" : "text-muted")}>
                            {item.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex-1" />
                  )}

                  {/* 진행률 */}
                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-faint">진행률</span>
                      <span className="font-mono text-fg-2">{pct}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
                      <div className="h-full rounded-pill bg-accent transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* 메타 + 액션 버튼 */}
                  <div className="flex items-center justify-between border-t border-border pt-3">
                    <div className="flex items-center gap-3 text-xs text-faint">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />{task.elapsed}
                      </span>
                      <span className="flex items-center gap-1">
                        <Cpu className="h-3.5 w-3.5" />{task.model}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {/* 상세 보기 */}
                      <button
                        onClick={() => setDetailTaskId(task.id)}
                        title="상세 보기"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-surface-2 hover:text-fg">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      {/* Resume (failed + resumable) */}
                      {task.rawStatus === "failed" && task.resumable && (
                        <button
                          onClick={() => void handleResume(task)}
                          disabled={isActing}
                          title="이어하기"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-accent-soft hover:text-accent disabled:opacity-40">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Cancel (running/pending) */}
                      {(task.status === "running" || task.rawStatus === "pending") && (
                        <button
                          onClick={() => void handleCancel(task)}
                          disabled={isActing}
                          title="취소"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => void handleDelete(task)}
                        disabled={isActing}
                        title="삭제"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 새 작업 모달 */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="새 에이전트 작업">
        <CreateTaskForm onClose={() => setShowCreate(false)} onCreated={handleCreated} />
      </Modal>

      {/* 작업 상세 모달 */}
      {detailTaskId && (
        <Modal open={!!detailTaskId} onClose={() => setDetailTaskId(null)} title="작업 상세">
          <TaskDetailModal taskId={detailTaskId} onClose={() => setDetailTaskId(null)} />
        </Modal>
      )}
    </>
  );
}
