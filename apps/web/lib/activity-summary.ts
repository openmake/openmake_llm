/**
 * "지금 무엇을 하는지" 통합 상태 집계 — 승인함·작업 화면에 흩어진 것을 한 패널에서 보여 주기 위한 순수 함수.
 * 입력은 기존 REST(작업 목록·내 대기 승인)와 채팅 생성 여부다. 새 API 는 없다.
 */
import { isQuestionApproval } from "./hitl-question";

/** "최근 끝남"에 보여 줄 최대 개수. */
export const ACTIVITY_RECENT_MAX = 5;
/** "최근 끝남"으로 치는 기간(ms) — 이보다 오래된 것은 작업 화면에서 본다. */
export const ACTIVITY_RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** 아직 끝나지 않은 작업 상태 — 승인 대기로 멈춘(paused) 작업도 진행 중으로 본다. */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set(["running", "queued", "paused", "pending"]);
const ENDED_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled"]);

export interface ActivityTask {
  id: string;
  goal: string;
  status: string;
  progress?: number;
  completed_at?: string;
  created_at?: string;
}

export interface ActivityApproval {
  approvalId: string;
  taskId: string;
  toolName: string;
  args?: Record<string, unknown>;
}

export interface ActivityNeedsInput {
  approvalId: string;
  taskId: string;
  toolName: string;
  /** 질문형 승인(ask_human 등)의 질문 본문 */
  question?: string;
  /** 승인이 걸린 작업의 목표 — 작업 목록에 없으면 비운다 */
  goal?: string;
}

export interface ActivitySummary {
  needsInput: ActivityNeedsInput[];
  running: Array<{ id: string; goal: string; status: string; progress: number }>;
  recent: Array<{ id: string; goal: string; status: string }>;
  chatGenerating: boolean;
  /** 사이드바 버튼에 띄울 숫자 — 입력 필요 + 진행 중(채팅 생성 포함) */
  badge: number;
}

export function summarizeActivity(input: {
  tasks: ActivityTask[];
  approvals: ActivityApproval[];
  chatGenerating: boolean;
  now: number;
}): ActivitySummary {
  const { tasks, approvals, chatGenerating, now } = input;
  const goalOf = new Map(tasks.map((t) => [t.id, t.goal]));

  const needsInput = approvals.map((a) => {
    const question = isQuestionApproval(a.toolName) && typeof a.args?.question === "string" ? a.args.question : undefined;
    const goal = goalOf.get(a.taskId);
    return {
      approvalId: a.approvalId,
      taskId: a.taskId,
      toolName: a.toolName,
      ...(question ? { question } : {}),
      ...(goal ? { goal } : {}),
    };
  });

  const running = tasks
    .filter((t) => ACTIVE_STATUSES.has(t.status))
    .map((t) => ({ id: t.id, goal: t.goal, status: t.status, progress: t.progress ?? 0 }));

  const recent = tasks
    .filter((t) => ENDED_STATUSES.has(t.status))
    .map((t) => ({ task: t, endedAt: Date.parse(t.completed_at ?? t.created_at ?? "") }))
    .filter((e) => Number.isFinite(e.endedAt) && now - e.endedAt <= ACTIVITY_RECENT_WINDOW_MS)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, ACTIVITY_RECENT_MAX)
    .map(({ task }) => ({ id: task.id, goal: task.goal, status: task.status }));

  return {
    needsInput,
    running,
    recent,
    chatGenerating,
    badge: needsInput.length + running.length + (chatGenerating ? 1 : 0),
  };
}
