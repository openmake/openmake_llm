/**
 * 중단 보존 (2026-10-29) — 죽은(half-open) 소켓으로 보낸 `abort` 는 서버에 닿지 않는다.
 * 생성 중에 누른 중단은 기억해 두었다가, 재연결 뒤 resume 으로 스트림을 새 소켓에 붙인 **다음** 다시 보낸다
 * (서버 중단 컨트롤러는 resume 의 attach 로 새 소켓에 넘어온다 — ws-stream-registry.attach).
 * 순수 함수 — use-chat-socket 이 ref 에 대기 플래그를 두고 호출한다.
 *
 * @module lib/ws-pending-abort
 */

/**
 * 재연결 onopen 에 보낼 메시지 — resume 이 있으면 그것을 먼저, 중단 대기 중이면 그 뒤에 abort.
 * resume 을 보내지 않으면 새 소켓에 붙을 스트림이 없으니 abort 도 보내지 않고 대기를 푼다.
 * 중단 대기는 서버가 결과(aborted·done·error·resume_none)를 알려 줄 때까지 유지한다 — 새 소켓도 죽으면 다음 재연결에서 다시 보낸다.
 */
export function messagesOnReopen<R extends object>(
  resume: R | null,
  pendingAbort: boolean,
): { messages: Array<R | { type: "abort" }>; pendingAbort: boolean } {
  if (!resume) return { messages: [], pendingAbort: false };
  return pendingAbort
    ? { messages: [resume, { type: "abort" }], pendingAbort: true }
    : { messages: [resume], pendingAbort: false };
}

const SETTLING_EVENTS = new Set(["aborted", "done", "error", "resume_none"]);

/** 이 이벤트를 받으면 스트림이 끝났다(또는 이어받을 것이 없다) — 중단 대기를 푼다. */
export function clearsPendingAbort(type: string): boolean {
  return SETTLING_EVENTS.has(type);
}
