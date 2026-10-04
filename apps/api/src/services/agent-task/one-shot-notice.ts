/**
 * 일회성 안내 표식 — 그 실행의 자원 상태를 알리는 안내("검색 한도에 도달했으니 더 검색하지 마라" 등)에 단다.
 *
 * 이런 안내는 체크포인트의 대화에 그대로 남는데, fork 한 작업은 검색·브라우저 횟수와 턴·토큰 예산이 새로 시작한다.
 * 안내가 따라가면 새 작업의 모델은 쓸 수 있는 도구를 스스로 쓰지 않는다. 표식을 달아 두고 fork 때 대화에서 뺀다.
 * 표식은 메시지 객체의 추가 필드라 체크포인트(JSON)에는 남고, 모델로 보내는 변환(toOpenAIMessages)은 아는 필드만 옮기므로 실리지 않는다.
 *
 * 모델 응답에 대한 되묻기(빈 응답·검증 실패·stuck·행동 예고 재촉)는 따로 표식(replyNudge)을 단다. 이것만 빼면 assistant 가
 * 연달아 남으므로, fork 때 그 안내를 부른 직전 assistant 메시지와 짝으로 뺀다(cleanConversationForFork).
 *
 * @module services/agent-task/one-shot-notice
 */
import type { ChatMessage } from '../../llm/types';
import { getForkNeutralContinueLine } from '../../prompts/agent-task-schedule';

type OneShotMessage = ChatMessage & { oneShot?: boolean; replyNudge?: boolean };

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

/** 모델 응답에 대한 되묻기(user 역할) — 빈 응답·검증 실패·stuck·행동 예고 재촉. */
export function replyNudge(content: string): ChatMessage {
    const m: OneShotMessage = { role: 'user', content, replyNudge: true };
    return m;
}

export function isReplyNudge(m: ChatMessage): boolean {
    return (m as OneShotMessage).replyNudge === true;
}

/**
 * PURE: fork 가 물려줄 대화 — 일회성 자원 안내를 빼고, 되묻기는 그것을 부른 assistant 메시지와 짝으로 뺀다.
 * 연달아 붙은 되묻기는 한 묶음으로 본다. 묶음 앞 메시지에 따라:
 *   - 도구 호출 없는 assistant(빈 응답 자리표시·예고만 한 응답·검증에 걸린 답) → 그 메시지와 묶음을 함께 뺀다.
 *   - 그 밖(도구 결과·도구 호출을 담은 assistant)이고 뒤가 assistant → 묶음을 중립적인 한 줄로 바꾼다(user 차례를 남긴다).
 *   - 그 밖이고 뒤가 assistant 가 아님(도구 결과가 이어지거나 대화 끝) → 묶음만 뺀다. 호출과 결과가 다시 붙는다.
 * stripReplies=false 면 일회성 자원 안내만 뺀다.
 */
export function cleanConversationForFork(conversation: ChatMessage[], opts: { stripReplies?: boolean } = {}): ChatMessage[] {
    const src = stripOneShotNotices(conversation);
    if (opts.stripReplies === false) return src;
    const out: ChatMessage[] = [];
    for (let i = 0; i < src.length; i++) {
        if (!isReplyNudge(src[i])) { out.push(src[i]); continue; }
        while (i + 1 < src.length && isReplyNudge(src[i + 1])) i++;
        const prev = out[out.length - 1];
        const next = src[i + 1];
        if (prev?.role === 'assistant' && !prev.tool_calls?.length) out.pop();
        else if (next?.role === 'assistant' && prev?.role !== 'user') out.push({ role: 'user', content: getForkNeutralContinueLine() });
    }
    return out;
}
