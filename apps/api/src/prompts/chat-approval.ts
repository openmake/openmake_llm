/**
 * 채팅 도구 승인(W3 S3) — 승인을 받지 못한 호출 대신 모델에게 주는 도구 결과 문구.
 * 한국어는 한국어, 그 밖의 언어는 영어(prompt-locales 관행 — `resolvePromptLocale(lang) === 'ko'`).
 *
 * @module prompts/chat-approval
 */
import type { ApprovalRejectReason } from '../services/task-sandbox/approval-gate';
import { resolvePromptLocale } from '../chat/language-policy';

type DeniedKind = 'user' | 'timeout' | 'policy_floor';

const DENIED_TEXTS: Record<'ko' | 'en', Record<DeniedKind, string>> = {
    ko: {
        user: 'Error: 사용자가 도구 {tool} 실행을 승인하지 않았습니다. 같은 호출을 되풀이하거나 인자만 바꿔 다시 요청하지 말고, 같은 결과를 다른 도구로 얻으려 하지도 마세요. 이 도구 없이 답할 수 있는 범위에서 답하고, 하지 못한 일은 그렇다고 알리세요.',
        timeout: 'Error: 도구 {tool} 의 승인 대기 시간이 지나 실행하지 않았습니다(무응답). 이 도구 없이 답할 수 있는 범위에서 답하고, 필요하면 사용자에게 다시 요청해 달라고 안내하세요.',
        policy_floor: "Error: 도구 {tool} 은(는) 승인 정책 'none'(무승인)에서는 쓸 수 없습니다 — 사람의 승인이 필요한 호출입니다. 이 도구 없이 답할 수 있는 범위에서 답하세요.",
    },
    en: {
        user: 'Error: The user did not approve running the tool {tool}. Do not repeat the call or retry it with different arguments, and do not try to get the same result through another tool. Answer as far as you can without it, and say what you could not do.',
        timeout: 'Error: The approval for the tool {tool} timed out (no response), so it was not run. Answer as far as you can without it, and if needed tell the user they can ask again.',
        policy_floor: "Error: The tool {tool} cannot be used under the 'none' (no-approval) policy — it is a call that needs human approval. Answer as far as you can without it.",
    },
};

/** 승인 거절 사유별 도구 결과 — timeout·policy_floor 는 각자, 그 밖(명시 거절·중단·사유 없음)은 거절 문구. */
export function getChatApprovalDeniedResult(toolName: string, reason: ApprovalRejectReason | undefined, langCode = 'ko'): string {
    const texts = resolvePromptLocale(langCode) === 'ko' ? DENIED_TEXTS.ko : DENIED_TEXTS.en;
    const kind: DeniedKind = reason === 'timeout' || reason === 'policy_floor' ? reason : 'user';
    return texts[kind].replace('{tool}', toolName);
}
