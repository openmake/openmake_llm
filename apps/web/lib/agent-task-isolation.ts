/**
 * 로컬 실행 worktree 격리 상태 표시(200) — 서버가 정한 값(`AgentTaskIsolation`)을 문구 키·색으로 옮기기만 한다(판정 없음).
 * 작업 상세 뱃지와 채팅 작업 카드가 같이 쓴다. 모르는 state·reason 은 null(그리지 않는다).
 */
import type { AgentTaskIsolation } from "@openmake/shared-types";

export type IsolationTone = "accent" | "neutral" | "warn";

export interface IsolationLabel {
  /** `agentTasks.isolation.*` 아래 키 */
  key: "worktree" | "worktreeKept" | "worktreeRemoved" | "notRepo" | "disabled" | "unavailable";
  params: { branch?: string; path?: string };
  tone: IsolationTone;
}

const DIRECT: Record<string, Pick<IsolationLabel, "key" | "tone">> = {
  not_repo: { key: "notRepo", tone: "neutral" },
  disabled: { key: "disabled", tone: "neutral" },
  unavailable: { key: "unavailable", tone: "warn" },
};

export function isolationLabel(isolation: AgentTaskIsolation | null | undefined): IsolationLabel | null {
  if (!isolation) return null;
  if (isolation.state === "worktree") {
    if (isolation.outcome === "kept") return { key: "worktreeKept", params: { branch: isolation.branch, path: isolation.worktreeRel }, tone: "accent" };
    if (isolation.outcome === "removed") return { key: "worktreeRemoved", params: {}, tone: "neutral" };
    if (isolation.outcome === undefined) return { key: "worktree", params: { branch: isolation.branch }, tone: "accent" };
    return null;
  }
  if (isolation.state === "direct") {
    const d = Object.prototype.hasOwnProperty.call(DIRECT, isolation.reason) ? DIRECT[isolation.reason] : undefined;
    return d ? { ...d, params: {} } : null;
  }
  return null;
}

/** 작업 조회 응답(종료 재조회·재동기화)의 `task.isolation` → 카드 병합분. 응답에 없으면(옛 서버) 건드리지 않는다. */
export function isolationFromTask(task: { isolation?: AgentTaskIsolation | null }): { isolation?: AgentTaskIsolation } {
  return task.isolation === undefined ? {} : { isolation: task.isolation ?? undefined };
}

/** 진행 이벤트의 `isolation` → 카드 병합분. 없으면 건드리지 않는다. */
export function isolationFromEvent(ev: { isolation?: AgentTaskIsolation }): { isolation?: AgentTaskIsolation } {
  return ev.isolation ? { isolation: ev.isolation } : {};
}

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/**
 * 종료 뒤 정리 결과 알림(reason "isolation")이고 카드가 이미 종료 상태면 격리 표시만 바꾼다 —
 * 결과·산출물 재조회(종료 처리)를 다시 돌리지 않는다. 판정은 isolation 필드 유무가 아니라 reason 으로 한다.
 */
export function isIsolationOnlyUpdate(reason: string | undefined, cardStatus: string | undefined): boolean {
  return reason === "isolation" && TERMINAL.has(cardStatus ?? "");
}

/** 작업별 종료 재조회 세대를 하나 올리고 그 번호를 돌려준다 — 재조회를 시작할 때 부른다. */
export function startTerminalFetch(gens: Map<string, number>, taskId: string): number {
  const gen = (gens.get(taskId) ?? 0) + 1;
  gens.set(taskId, gen);
  return gen;
}

/** 이 재조회가 그 작업의 마지막으로 시작한 조회인가 — 아니면 응답을 병합하지 않는다("나중에 시작한 조회가 이긴다"). */
export function isLatestTerminalFetch(gens: Map<string, number>, taskId: string, gen: number): boolean {
  return gens.get(taskId) === gen;
}
