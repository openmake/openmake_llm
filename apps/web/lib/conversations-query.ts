/**
 * 사이드바 "최근 대화" 질의 키 — 누구의 목록인지 담는다. /api/chat/conversations 는 토큰이 없으면
 * 200 + 게스트 빈 목록을 주므로, 키에 사용자가 없으면 refresh 전에 받은 게스트 결과가 굳는다.
 * 무효화는 앞부분 ["conversations"] 로 하면 사용자 키 질의까지 닿는다.
 */
export function conversationsQueryKey(userId: string | null | undefined): readonly [string, string] {
  return ["conversations", userId ?? "guest"];
}
