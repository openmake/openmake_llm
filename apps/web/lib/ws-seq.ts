/**
 * 스트림 이어받기 커서 (F19.11) — 서버가 이벤트에 붙이는 streamId·seq 로 마지막 수신 위치를 기억하고 중복을 거른다.
 * 서버 ws-stream-registry 와 페어: 재연결 시 resume{streamId, afterSeq} 를 보내면 그 뒤 이벤트만 재생된다.
 * 순수 함수 — use-chat-socket 이 ref 에 커서를 두고 호출한다.
 */

export interface StreamCursor {
  streamId: string | null;
  lastSeq: number;
}

export const EMPTY_STREAM_CURSOR: StreamCursor = { streamId: null, lastSeq: 0 };

interface Envelope {
  type?: string;
  streamId?: unknown;
  seq?: unknown;
}

/** 일반 이벤트 — 적용 여부와 갱신된 커서. 봉투가 없는 이벤트(구 서버·연결 메타)는 그대로 적용한다. */
export function acceptStreamEvent(cursor: StreamCursor, ev: Envelope): { apply: boolean; cursor: StreamCursor } {
  if (typeof ev.streamId !== "string" || typeof ev.seq !== "number" || !Number.isFinite(ev.seq)) {
    return { apply: true, cursor };
  }
  if (ev.streamId !== cursor.streamId) return { apply: true, cursor: { streamId: ev.streamId, lastSeq: ev.seq } };
  if (ev.seq <= cursor.lastSeq) return { apply: false, cursor };
  return { apply: true, cursor: { streamId: ev.streamId, lastSeq: ev.seq } };
}

/**
 * stream_resume — 같은 스트림이면 보낸 afterSeq(=현재 lastSeq)를 유지해 뒤이어 재생되는 이벤트를 받고,
 * 다른 스트림이면 0 부터 받는다(서버는 미전달 이벤트만 재생한다).
 */
export function cursorAfterResume(cursor: StreamCursor, ev: Envelope): StreamCursor {
  if (typeof ev.streamId !== "string") return cursor;
  return ev.streamId === cursor.streamId ? cursor : { streamId: ev.streamId, lastSeq: 0 };
}

/** resume 요청에 실을 커서 필드 — 아직 받은 스트림이 없으면 빈 객체(서버 종전 동작). */
export function resumeCursorFields(cursor: StreamCursor): { streamId?: string; afterSeq?: number } {
  return cursor.streamId ? { streamId: cursor.streamId, afterSeq: cursor.lastSeq } : {};
}
