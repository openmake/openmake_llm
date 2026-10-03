/**
 * 일회성 안내 표식 — 그 실행의 자원 상태를 알리는 안내("검색 한도에 도달했으니 더 검색하지 마라" 등)에 단다.
 *
 * 이런 안내는 체크포인트의 대화에 그대로 남는데, fork 한 작업은 검색·브라우저 횟수와 턴·토큰 예산이 새로 시작한다.
 * 안내가 따라가면 새 작업의 모델은 쓸 수 있는 도구를 스스로 쓰지 않는다. 표식을 달아 두고 fork 때 대화에서 뺀다.
 * 표식은 메시지 객체의 추가 필드라 체크포인트(JSON)에는 남고, 모델로 보내는 변환(toOpenAIMessages)은 아는 필드만 옮기므로 실리지 않는다.
 * 대상은 턴 시작에 끼워 넣는 자원 안내뿐이다 — 모델 응답에 대한 되묻기(빈 응답·검증 실패 등)는 빼면 assistant 가 연달아 남는다.
 *
 * @module services/agent-task/one-shot-notice
 */
import type { ChatMessage } from '../../llm/types';

type OneShotMessage = ChatMessage & { oneShot?: boolean };

/** 일회성 안내 메시지(user 역할 — 대화 중간 system 은 vLLM 이 거절한다). */
export function oneShotNotice(content: string): ChatMessage {
    const m: OneShotMessage = { role: 'user', content, oneShot: true };
    return m;
}

export function isOneShotNotice(m: ChatMessage): boolean {
    return (m as OneShotMessage).oneShot === true;
}

/** PURE: 일회성 안내를 뺀 새 대화 — fork 가 쓴다. */
export function stripOneShotNotices(conversation: ChatMessage[]): ChatMessage[] {
    return conversation.filter((m) => !isOneShotNotice(m));
}
