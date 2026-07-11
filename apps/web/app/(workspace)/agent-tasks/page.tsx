"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Sparkles,
  Check,
  LoaderCircle,
  Clock,
  Cpu,
  X,
  Trash2,
  RotateCcw,
  ChevronRight,
  CalendarClock,
  Plus,
  Play,
} from "lucide-react";
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
type ApiTaskStatus = "pending" | "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

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
  /** 누적 LLM 토큰(4-4) — terminal 시 기록. */
  totalTokens?: number;
}

type PlanStepStatus = "not_started" | "in_progress" | "completed" | "blocked";
interface PlanStep {
  text: string;
  status: PlanStepStatus;
  note?: string;
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
  plan?: PlanStep[] | null;
  total_tokens?: number | null;
}

type TaskFilesResponse = ApiSuccess<{ files: string[] }>;

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

type TFn = ReturnType<typeof useTranslations>;

function formatElapsed(t: TFn, start?: string, end?: string): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const sec = Math.round((e - s) / 1000);
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m > 0
    ? t("elapsedMinSec", { m, s: String(r).padStart(2, "0") })
    : t("elapsedSec", { s: r });
}

function mapTask(tr: TFn, t: ApiAgentTask): AgentTask {
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
    elapsed: formatElapsed(tr, t.created_at, t.completed_at),
    currentTurn: t.current_turn ?? 0,
    maxTurns: t.max_turns ?? 0,
    progress,
    checklist: [],
    resumable: t.resumable,
    totalTokens: typeof t.total_tokens === "number" ? t.total_tokens : undefined,
  };
}

/* ── 목업 폴백 ─────────────────────────────────────────────── */
function buildTaskFallback(t: TFn): AgentTask[] {
  return [
  {
    id: "t1",
    goal: t("mock.t1Goal"),
    status: "running",
    rawStatus: "running",
    model: "Pro",
    elapsed: t("elapsedMinSec", { m: 2, s: "41" }),
    currentTurn: 3,
    maxTurns: 8,
    progress: 60,
    checklist: [
      { label: t("mock.t1Step1"), done: true },
      { label: t("mock.t1Step2"), done: true },
      { label: t("mock.t1Step3"), done: true },
      { label: t("mock.t1Step4"), done: false },
      { label: t("mock.t1Step5"), done: false },
    ],
  },
  {
    id: "t2",
    goal: t("mock.t2Goal"),
    status: "completed",
    rawStatus: "completed",
    model: "Default",
    elapsed: t("elapsedMinSec", { m: 5, s: "08" }),
    currentTurn: 6,
    maxTurns: 6,
    progress: 100,
    checklist: [
      { label: t("mock.t2Step1"), done: true },
      { label: t("mock.t2Step2"), done: true },
      { label: t("mock.t2Step3"), done: true },
      { label: t("mock.t2Step4"), done: true },
    ],
  },
  {
    id: "t3",
    goal: t("mock.t3Goal"),
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
}

const STATUS_META: Record<TaskStatus, { labelKey: string; tone: "accent" | "success" | "neutral" }> = {
  running: { labelKey: "status.running", tone: "accent" },
  completed: { labelKey: "status.completed", tone: "success" },
  pending: { labelKey: "status.pending", tone: "neutral" },
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

/* ── 작업 상세 모달 (스텝 타임라인) ─────────────────────── */
const PLAN_MARK: Record<PlanStepStatus, string> = {
  not_started: "○",
  in_progress: "◐",
  completed: "●",
  blocked: "✕",
};

function TaskDetailModal({
  taskId,
}: {
  taskId: string;
}) {
  const t = useTranslations("agentTasks");
  const [detail, setDetail] = useState<{ task: ApiAgentTask; steps: ApiTaskStep[] } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // 라이브 폴링: 실행 중(running/paused)이면 주기적으로 갱신 — "컴퓨터" 패널 실시간성.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await ApiClient.get<AgentTaskDetailResponse>(`/api/agent-tasks/${taskId}`);
        if (cancelled) return;
        setDetail(res?.data ?? null);
        const st = res?.data?.task?.status;
        // 완료 task 의 산출물 파일 목록(보존된 workspace).
        if (st === "completed") {
          try {
            const f = await ApiClient.get<TaskFilesResponse>(`/api/agent-tasks/${taskId}/files`);
            if (!cancelled) setFiles(f?.data?.files ?? []);
          } catch { /* ignore */ }
        }
        // 진행 중(또는 대기 중)이면 계속 폴링.
        if (!cancelled && (st === "running" || st === "paused" || st === "pending" || st === "queued")) {
          timer = setTimeout(load, 2500);
        }
      } catch {
        // detail 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [taskId]);

  const plan = detail?.task.plan ?? [];

  return (
    <div className="space-y-4">
      {loading && !detail ? (
        <div className="flex items-center gap-2 py-8 justify-center text-muted text-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : !detail ? (
        <p className="text-sm text-danger py-8 text-center">{t("detailLoadError")}</p>
      ) : (
        <>
          <div className="rounded-md border border-border bg-surface-2 p-4">
            <p className="mb-1 text-xs font-medium text-muted">{t("goalLabel")}</p>
            <p className="text-sm text-fg">{detail.task.goal}</p>
            <div className="mt-2 flex items-center gap-3 text-xs text-faint">
              <span className="flex items-center gap-1">
                {t("stateLabel")} {detail.task.status}
                {(detail.task.status === "running" || detail.task.status === "paused") && (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                )}
              </span>
              <span>{t("turnLabel")} {detail.task.current_turn ?? 0}/{detail.task.max_turns ?? 0}</span>
            </div>
          </div>

          {/* 계획 패널 (G3 plan + G5 실시간 상태) */}
          {plan.length > 0 && (
            <div className="rounded-md border border-border bg-surface-1 p-3">
              <p className="mb-2 text-xs font-medium text-fg-2">
                {t("planLabel", { completed: plan.filter((s) => s.status === "completed").length, total: plan.length })}
              </p>
              <ul className="space-y-1">
                {plan.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={cn(
                      "font-mono",
                      s.status === "completed" && "text-success",
                      s.status === "in_progress" && "text-warning",
                      s.status === "blocked" && "text-danger",
                      s.status === "not_started" && "text-faint",
                    )}>{PLAN_MARK[s.status]}</span>
                    <span className={cn(
                      "min-w-0 flex-1",
                      s.status === "completed" ? "text-muted line-through" : "text-fg-2",
                    )}>
                      {s.text}{s.note ? <span className="text-faint"> — {s.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 산출물 파일 (완료 시 workspace 보존) */}
          {files.length > 0 && (
            <div className="rounded-md border border-border bg-surface-1 p-3">
              <p className="mb-2 text-xs font-medium text-fg-2">{t("outputsLabel", { count: files.length })}</p>
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f} className="text-xs">
                    <a
                      href={`/api/agent-tasks/${taskId}/files/download?path=${encodeURIComponent(f)}`}
                      className="font-mono text-accent hover:underline"
                      target="_blank" rel="noopener noreferrer"
                    >
                      {f}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 실행 스텝 — 터미널 스타일(도구 출력 전문) */}
          {detail.steps.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">{t("noSteps")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-fg-2">{t("stepsLabel", { count: detail.steps.length })}</p>
              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {detail.steps.map((step, i) => {
                  const body = step.tool_output || step.content || "";
                  const isTool = step.type === "tool_result" || !!step.tool_name;
                  return (
                    <div key={step.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-mono text-faint">
                          {i + 1}
                        </div>
                        {i < detail.steps.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className="pb-3 min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted mb-0.5">
                          <Badge tone="neutral">{step.type ?? "step"}</Badge>
                          {step.tool_name && <span className="font-mono">{step.tool_name}</span>}
                        </div>
                        {body && (
                          <pre className={cn(
                            "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1 text-xs leading-relaxed",
                            isTool ? "bg-surface-2 font-mono text-muted" : "text-fg-2",
                          )}>
                            {body.slice(0, 4000)}
                          </pre>
                        )}
                      </div>
                    </div>
                  );
                })}
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
  const t = useTranslations("agentTasks");
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

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

  async function run(approvalId: string, fn: () => Promise<void>) {
    setBusy(approvalId);
    try {
      await fn();
      await load();
    } catch (err) {
      alert(t("processFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setBusy(null);
    }
  }

  const decide = (approvalId: string, decision: "approve" | "reject") =>
    run(approvalId, () => ApiClient.post(`/api/agent-tasks/approvals/${approvalId}/${decision}`, {}));
  const answer = (approvalId: string) =>
    run(approvalId, () => ApiClient.post(`/api/agent-tasks/approvals/${approvalId}/answer`, { text: answers[approvalId] ?? "" }));
  // task 자동승인(4-2) — 이후 이 작업의 도구 호출은 승인 없이 진행(ask_human 제외).
  const autoApprove = (taskId: string, approvalId: string) =>
    run(approvalId, () => ApiClient.post(`/api/agent-tasks/${taskId}/approvals/auto-approve`, {}));

  if (pending.length === 0) return null;
  const firstToolApproval = pending.find((p) => p.toolName !== "ask_human");

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-fg-2">
          {t("approvalsTitle", { count: pending.length })}
        </p>
        {firstToolApproval && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            title={t("autoApproveHint")}
            onClick={() => autoApprove(firstToolApproval.taskId, firstToolApproval.approvalId)}
          >
            {t("autoApprove")}
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {pending.map((p) => {
          // ask_human 은 도구 승인이 아니라 사용자 질문 — 자유텍스트 답변 채널을 렌더.
          if (p.toolName === "ask_human") {
            const question = typeof p.args?.question === "string" ? p.args.question : "";
            const text = answers[p.approvalId] ?? "";
            return (
              <div key={p.approvalId} className="space-y-2 rounded-md border border-line bg-bg-1 p-2">
                <p className="text-xs font-semibold text-fg-2">{t("question")}</p>
                {question && <p className="break-words text-xs text-fg-1">{question}</p>}
                <textarea
                  value={text}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [p.approvalId]: e.target.value }))}
                  placeholder={t("answerPlaceholder")}
                  rows={2}
                  disabled={busy === p.approvalId}
                  className="w-full resize-y rounded-md border border-line bg-bg-2 p-1.5 text-xs text-fg-1 disabled:opacity-50"
                />
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="outline" disabled={busy === p.approvalId} onClick={() => decide(p.approvalId, "reject")}>
                    {t("skip")}
                  </Button>
                  <Button size="sm" disabled={busy === p.approvalId || !text.trim()} onClick={() => answer(p.approvalId)}>
                    {t("sendAnswer")}
                  </Button>
                </div>
              </div>
            );
          }
          return (
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
                  {t("reject")}
                </Button>
                <Button
                  size="sm"
                  disabled={busy === p.approvalId}
                  onClick={() => decide(p.approvalId, "approve")}
                >
                  {t("approve")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ── 스케줄(반복 트리거) 패널 (Phase 3-A) ───────────────────── */
interface ApiSchedule {
  id: string;
  goal: string;
  cron?: string | null;
  interval_seconds?: number | null;
  max_turns: number;
  enabled: boolean;
  next_run_at: string;
  last_run_at?: string | null;
  consecutive_failures: number;
}
type SchedulesResponse = ApiSuccess<{ schedules: ApiSchedule[]; total: number }>;

function SchedulesPanel() {
  const t = useTranslations("agentTasks");
  const [schedules, setSchedules] = useState<ApiSchedule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<"cron" | "interval">("cron");
  const [cron, setCron] = useState("0 8 * * *");
  const [intervalMin, setIntervalMin] = useState(60);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<SchedulesResponse>("/api/agent-task-schedules");
      setSchedules(r?.data?.schedules ?? []);
    } catch {
      // 401·네트워크·플래그 OFF(404): 빈 목록 유지
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (err) {
      alert(t("processFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run("new", async () => {
      const body = kind === "cron" ? { goal, cron } : { goal, intervalSeconds: Math.max(300, intervalMin * 60) };
      await ApiClient.post("/api/agent-task-schedules", body);
      setGoal("");
      setOpen(false);
    });
  const toggle = (s: ApiSchedule) =>
    run(s.id, () => ApiClient.patch(`/api/agent-task-schedules/${s.id}`, { enabled: !s.enabled }));
  const runNow = (s: ApiSchedule) => run(s.id, () => ApiClient.post(`/api/agent-task-schedules/${s.id}/run`, {}));
  const remove = (s: ApiSchedule) => run(s.id, () => ApiClient.del(`/api/agent-task-schedules/${s.id}`));

  const timingLabel = (s: ApiSchedule) =>
    s.cron ? s.cron : s.interval_seconds ? t("schedules.everyMinutes", { min: Math.round(s.interval_seconds / 60) }) : "—";

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg-2">
          <CalendarClock className="h-4 w-4 text-accent" /> {t("schedules.title")}
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> {t("schedules.create")}
        </Button>
      </div>

      {open && (
        <div className="mb-3 space-y-2 rounded-md border border-line bg-bg-1 p-3">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t("schedules.goalPlaceholder")}
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-bg-2 p-2 text-sm text-fg-1"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "cron" | "interval")}
              className="rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-fg-1"
            >
              <option value="cron">{t("schedules.cron")}</option>
              <option value="interval">{t("schedules.interval")}</option>
            </select>
            {kind === "cron" ? (
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 8 * * *"
                className="min-w-40 flex-1 rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-xs text-fg-1"
              />
            ) : (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="number"
                  min={5}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Math.max(5, Number(e.target.value) || 5))}
                  className="w-20 rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-fg-1"
                />
                {t("schedules.minutes")}
              </label>
            )}
            <Button size="sm" disabled={busy === "new" || !goal.trim()} onClick={create}>
              {t("schedules.add")}
            </Button>
          </div>
          <p className="text-xs text-faint">{t("schedules.cronHint")}</p>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-xs text-muted">{t("schedules.empty")}</p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg-1 p-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-fg-1">{s.goal}</p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{timingLabel(s)}</span>
                  {" · "}
                  {t("schedules.nextRun", { time: new Date(s.next_run_at).toLocaleString() })}
                  {!s.enabled && ` · ${t("schedules.disabled")}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" disabled={busy === s.id || !s.enabled} onClick={() => runNow(s)} title={t("schedules.runNow")}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => toggle(s)}>
                  {s.enabled ? t("schedules.disable") : t("schedules.enable")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => remove(s)} title={t("schedules.delete")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AgentTasksPage() {
  const t = useTranslations("agentTasks");
  const router = useRouter();
  const [tasks, setTasks] = useState<AgentTask[]>(() => buildTaskFallback(t));
  const [loading, setLoading] = useState(true);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // taskId being acted on

  const loadTasks = useCallback(async () => {
    try {
      const res = await ApiClient.get<AgentTasksResponse>("/api/agent-tasks");
      setTasks((res?.data?.tasks ?? []).map((task) => mapTask(t, task)));
    } catch {
      // 401·네트워크 실패: 목업 폴백 유지
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadTasks();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadTasks]);

  async function handleCancel(task: AgentTask) {
    if (!window.confirm(t("cancelConfirm", { goal: task.goal.slice(0, 40) }))) return;
    setActionLoading(task.id);
    try {
      await ApiClient.post(`/api/agent-tasks/${task.id}/cancel`, {});
      await loadTasks();
    } catch (err) {
      alert(t("cancelFailed", { message: err instanceof Error ? err.message : t("error") }));
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
      alert(t("resumeFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(task: AgentTask) {
    if (!window.confirm(t("deleteConfirm", { goal: task.goal.slice(0, 40) }))) return;
    setActionLoading(task.id);
    try {
      await ApiClient.del(`/api/agent-tasks/${task.id}`);
      await loadTasks();
    } catch (err) {
      alert(t("deleteFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 실행 안내 배너 — 생성/실행은 채팅 인라인으로 일원화 */}
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            {t.rich("banner", {
              b: (chunks) => <span className="font-medium text-fg-2">{chunks}</span>,
            })}
          </p>
          <Button size="sm" variant="outline" onClick={() => router.push("/")}>
            {t("chatCta")}
          </Button>
        </Card>
        <ApprovalsPanel />
        <SchedulesPanel />
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted">{t("emptyDescription")}</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => router.push("/")}>
              {t("chatCta")}
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
                      {t(meta.labelKey)}
                      {task.rawStatus === "failed" && ` (${t("failedTag")})`}
                      {task.rawStatus === "cancelled" && ` (${t("cancelledTag")})`}
                    </Badge>
                    <span className="font-mono text-xs text-faint">
                      {t("turnShort", { current: task.currentTurn, max: task.maxTurns })}
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
                      <span className="text-faint">{t("progressLabel")}</span>
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
                      {typeof task.totalTokens === "number" && task.totalTokens > 0 && (
                        <span className="font-mono tabular-nums" title={t("tokensUsedHint")}>
                          {t("tokensUsed", { count: task.totalTokens.toLocaleString() })}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {/* 상세 보기 */}
                      <button
                        onClick={() => setDetailTaskId(task.id)}
                        title={t("detailTitle")}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-surface-2 hover:text-fg">
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      {/* Resume (failed + resumable) */}
                      {task.rawStatus === "failed" && task.resumable && (
                        <button
                          onClick={() => void handleResume(task)}
                          disabled={isActing}
                          title={t("resumeTitle")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-accent-soft hover:text-accent disabled:opacity-40">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Cancel (running/pending) */}
                      {(task.status === "running" || task.rawStatus === "pending") && (
                        <button
                          onClick={() => void handleCancel(task)}
                          disabled={isActing}
                          title={t("cancelTitle")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => void handleDelete(task)}
                        disabled={isActing}
                        title={t("deleteTitle")}
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

      {/* 작업 상세 모달 */}
      {detailTaskId && (
        <Modal open={!!detailTaskId} onClose={() => setDetailTaskId(null)} title={t("modalTitle")}>
          <TaskDetailModal taskId={detailTaskId} />
        </Modal>
      )}
    </>
  );
}
