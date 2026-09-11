/**
 * 추론(reasoning)만 오고 본문이 빈 턴을 답변으로 승격할지 — streamChat·nonStreamChat 공용 규칙.
 *
 * 승격은 원래 "reasoning 으로 온 것이 실은 답변" 인 두 경우의 워크어라운드다:
 *   ① vLLM 이 enable_thinking=false 요청의 출력까지 reasoning 채널로 보내는 오설정
 *   ② reasoning-parser 없는 서버에서 클라이언트 `</think>` 분리기가, `<think>` 를 prepend 하지
 *      않는 모델의 답변을 통째로 thinking 으로 흡수한 경우
 *
 * 그러나 thinking 을 명시 요청했고 서버 reasoning-parser 가 추론을 별도 필드로 분리해 보냈는데
 * 본문 없이 정상 종료(stop)했다면, 그 텍스트는 답변이 아니라 끝나지 않은 추론이다. 승격하면 추론
 * 원문이 답변으로 노출·저장된다(2026-09-11 실측: qwen3.8-27b 가 "ㅎㅇ" 에 깨진 추론 39토큰만 내고
 * 종료 → `The user is "The user1. <tool_result> 这个 …` 가 답변으로 저장). 이때는 승격하지 않고
 * 빈 본문을 돌려줘 호출자의 빈 응답 방어(채팅: 도구를 끈 재요청 1회)가 답변을 다시 받게 한다.
 *
 * finish_reason=length 는 기존대로 승격 + 절단 안내 — 한도 소진은 재요청해도 같다.
 */

import { createLogger } from '../utils/logger';

const log = createLogger('ReasoningOnly');

/**
 * reasoning 모델(Qwen3 등)이 reasoning 토큰만으로 max_tokens 를 소진해 `content` 가 `null|""`
 * 로 반환된 경우(finish_reason="length") 승격한 답변 끝에 붙이는 안내.
 * 해결책: max_tokens(num_predict) 증가 또는 `LLM_DISABLE_THINKING_BY_DEFAULT=true`.
 */
export const FALLBACK_REASONING_ONLY_NOTICE =
    '(응답 한도(max_tokens) 내에서 reasoning 단계만 완료되어 본문이 생성되지 않았습니다. ' +
    '재시도 시 더 짧게 질문하거나, 관리자에게 num_predict 증가 또는 reasoning 비활성화를 요청하세요.)';

export interface ReasoningOnlyTurn {
    /** 요청의 chat_template_kwargs.enable_thinking (미전송이면 undefined) */
    enableThinking: boolean | undefined;
    /** 서버 reasoning-parser 가 reasoning 을 별도 필드(delta.reasoning 등)로 보냈는지 */
    serverReasoningField: boolean;
    finishReason: string | null | undefined;
    model: string;
    thinkingChars: number;
    completionTokens?: number;
}

/** true 면 reasoning 을 답변으로 승격한다. 승격하지 않을 때는 관측용 warn 을 남긴다. */
export function shouldPromoteReasoningOnly(t: ReasoningOnlyTurn): boolean {
    if (t.enableThinking !== true || !t.serverReasoningField || t.finishReason === 'length') return true;
    log.warn('[ReasoningOnly] thinking 요청 턴이 본문 없이 종료 — 추론을 답변으로 승격하지 않음 '
        + `(model=${t.model} finish=${t.finishReason ?? '?'} completion_tokens=${t.completionTokens ?? '?'} thinking=${t.thinkingChars}자)`);
    return false;
}
