/**
 * 채팅 자동 스크롤 판정 — 사용자가 맨 아래 근처에 있을 때만 새 내용을 따라간다.
 * 위로 올려 과거 대화를 읽는 중이면 따라가지 않는다(답변이 흐르는 동안에도 읽던 자리를 지킨다).
 * 순수 함수 — message-list 가 스크롤 영역의 수치를 넘겨 호출한다.
 */

/** 맨 아래에서 이 거리 안이면 "맨 아래에 있다"로 본다(px). 한두 줄 올린 정도는 따라간다. */
export const STICK_THRESHOLD_PX = 80;

export function isNearBottom(
  m: { scrollTop: number; clientHeight: number; scrollHeight: number },
  thresholdPx: number = STICK_THRESHOLD_PX,
): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= thresholdPx;
}

/**
 * start 의 조상 중 overflow-y 가 auto|scroll 인 첫 요소(메시지 스크롤 컨테이너).
 * overflow hidden 인 앱 셸·main 은 스크롤러로 보지 않는다.
 */
export function findScroller(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start?.parentElement ?? null;
  while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
  return el;
}

/**
 * 스크롤러만 맨 아래로 — scrollIntoView 는 overflow hidden 조상(앱 셸)까지 밀어 올려
 * 사이드바·입력창이 화면 밖으로 밀린 채 남았다(2026-11-08).
 */
export function scrollToBottomOf(scroller: HTMLElement | null): void {
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}
