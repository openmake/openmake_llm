import type { ChatRole, WsChatRequest } from "@openmake/shared-types";

/** 요청 하나(현재 턴 + history)의 이미지 상한 — 서버 FILE_ATTACH_LIMITS.MAX_IMAGES 기본값과 같은 값(서버가 다시 검증) */
export const CHAT_MAX_IMAGES = 20;

type WireHistory = NonNullable<WsChatRequest["history"]>;

/**
 * 채팅 기록을 WS history 로 바꾼다(멀티턴 vision). 표시 전용 안내(notice)는 뺀다.
 * 이미지는 최신 메시지부터 남은 예산 안에서 메시지 단위로 통째로 싣고, 넘치는 오래된 메시지는 이미지 없이 보낸다.
 */
export function toWireHistory(
  history: ReadonlyArray<{ role: ChatRole; content: string; images?: string[]; notice?: boolean }>,
  currentImages: number,
  maxImages = CHAT_MAX_IMAGES,
): WireHistory {
  let budget = Math.max(0, maxImages - currentImages);
  const out: WireHistory = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.notice) continue;
    const n = m.images?.length ?? 0;
    if (n > 0 && n <= budget) {
      budget -= n;
      out.push({ role: m.role, content: m.content, images: m.images });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out.reverse();
}
