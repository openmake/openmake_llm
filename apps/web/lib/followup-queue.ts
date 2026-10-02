/**
 * 답변 중 후속 메시지 대기열 — 답변이 흐르는 동안 보낸 메시지를 쌓아 두었다가 답변이 끝나면 순서대로 하나씩 보낸다.
 * 순수 함수 — 상태는 store(followupQueue)가 쥐고, 전송은 use-chat-socket 이 답변 종료 시점에 한다.
 */

/** 대기열 상한 — 넘으면 더 받지 않는다(쌓아 둔 질문이 한참 뒤에 엉뚱한 맥락에서 나가는 것을 막는다). */
export const FOLLOWUP_QUEUE_MAX = 5;

export interface QueuedFollowup {
  id: string;
  text: string;
}

/** 답변이 끝난 방식 — 정상 종료만 다음 항목을 자동으로 보낸다. */
export type StreamEnd = "done" | "aborted" | "error" | "disconnected";

export function enqueueFollowup(queue: QueuedFollowup[], text: string, id: string): { queue: QueuedFollowup[]; accepted: boolean } {
  const trimmed = text.trim();
  if (!trimmed || queue.length >= FOLLOWUP_QUEUE_MAX) return { queue, accepted: false };
  return { queue: [...queue, { id, text: trimmed }], accepted: true };
}

export function removeFollowup(queue: QueuedFollowup[], id: string): QueuedFollowup[] {
  return queue.filter((q) => q.id !== id);
}

/**
 * 답변이 끝났을 때 자동으로 보낼 항목. 사용자가 정지했거나 오류·연결 끊김으로 끝났으면 보내지 않는다 —
 * 대기열은 남겨 두고 사용자가 직접 보내거나 지운다.
 */
export function nextFollowup(queue: QueuedFollowup[], end: StreamEnd): QueuedFollowup | null {
  return end === "done" ? (queue[0] ?? null) : null;
}

/** 답변 중에 대기시킬 수 있는 입력인가 — 텍스트만. 첨부(원본을 쥐고 있어야 한다)·에이전트 작업 모드는 종전처럼 막는다. */
export function canQueueFollowup(s: { isGenerating: boolean; text: string; hasAttachments: boolean; agentTaskMode: boolean }): boolean {
  return s.isGenerating && !!s.text.trim() && !s.hasAttachments && !s.agentTaskMode;
}
