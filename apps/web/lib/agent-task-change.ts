/**
 * 승인·계획 변경 알림(HITL 2단계) — WS `agent_task_progress` 의 `reason` 을 받으면 브라우저 이벤트로 흘려
 * 승인함·사이드바 배지·작업 상세가 폴링 주기를 기다리지 않고 다시 읽게 한다.
 * (소켓 훅은 하나지만 소비처가 서로 모르는 컴포넌트 세 곳이라 store 대신 window 이벤트로 느슨하게 잇는다.)
 */
export const AGENT_TASK_CHANGED_EVENT = "omk:agent-task-changed";

export interface AgentTaskChange {
  taskId: string;
  approvalId?: string;
  reason: "assigned" | "escalated" | "revoked" | "plan_edited";
}

export function announceAgentTaskChange(change: AgentTaskChange): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AgentTaskChange>(AGENT_TASK_CHANGED_EVENT, { detail: change }));
}

/** 구독 — 반환값으로 해제(useEffect cleanup 에 그대로 돌려준다) */
export function onAgentTaskChange(handler: (change: AgentTaskChange) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => handler((e as CustomEvent<AgentTaskChange>).detail);
  window.addEventListener(AGENT_TASK_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AGENT_TASK_CHANGED_EVENT, listener);
}
