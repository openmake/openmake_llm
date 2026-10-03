/**
 * 버린 대화의 스트림 걸러내기 — 답변이 흐르는 도중 "새 대화"로 대화를 지우면 그 답변의 남은 이벤트가
 * 빈 새 대화에 계속 써졌다. 지운 시점에 흐르던 스트림을 기억해 두고 그 뒤 이벤트(종료 포함)를 버린다.
 * 순수 함수 — use-chat-socket 이 ref 에 상태를 두고 호출한다(ws-seq 와 같은 방식).
 */

export interface StreamDiscardState {
  /** 버리기로 한 스트림 id */
  discarded: string | null;
  /** 지운 시점에 스트림 id 를 아직 몰랐다 — 다음에 처음 오는 스트림을 버린다 */
  pending: boolean;
}

export const EMPTY_DISCARD: StreamDiscardState = { discarded: null, pending: false };

/** 대화를 지웠다 — 생성 중이었으면 그 스트림을 버리기로 한다. activeStreamId 는 이번 요청에서 받은 스트림 id(아직 없으면 null). */
export function discardOnReset(state: StreamDiscardState, wasGenerating: boolean, activeStreamId: string | null): StreamDiscardState {
  if (!wasGenerating) return state;
  return activeStreamId ? { discarded: activeStreamId, pending: false } : { discarded: state.discarded, pending: true };
}

/** 이벤트 하나 — 버릴지와 갱신된 상태. 스트림 id 가 없는 이벤트는 그대로 적용한다. */
export function filterStreamEvent(state: StreamDiscardState, streamId: unknown): { drop: boolean; state: StreamDiscardState } {
  if (typeof streamId !== "string") return { drop: false, state };
  if (state.pending) return { drop: true, state: { discarded: streamId, pending: false } };
  return { drop: streamId === state.discarded, state };
}

/** 새 요청을 보냈다 — 아직 오지 않은 스트림을 기다리던 표시는 푼다(새 요청의 스트림을 버리지 않게). */
export function discardOnSend(state: StreamDiscardState): StreamDiscardState {
  return state.pending ? { discarded: state.discarded, pending: false } : state;
}
