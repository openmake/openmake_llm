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
