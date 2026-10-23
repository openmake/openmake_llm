/**
 * 채팅 도구 승인(W3 S3) — 채팅 도구 루프가 쓰는 메모리 전용 승인 레지스트리와 정책 결합.
 *
 * agent-task 레지스트리(`getApprovalRegistry`, 저장소 있음)와 분리한다: 채팅 대기는 요청 하나의 수명 안에서
 * 끝나므로 재시작 뒤 이어받을 것이 없고, 승인함에 남기지 않는다. 대기 키는 `chat:<chatId>`.
 *
 * @module services/chat-service/chat-approval
 */
import { ApprovalRegistry, type ApprovalResult, type PendingApproval } from '../task-sandbox/approval-gate';
import { resolveEffectivePolicy, strictestApprovalPolicy } from '../org/effective-policy';
import { CHAT_TOOL_APPROVAL } from '../../config/chat-approval';
import type { TaskSandboxApprovalPolicy } from '../../config/task-sandbox';

let registry: ApprovalRegistry | null = null;

/** 채팅 승인 레지스트리(모듈 싱글톤, 저장소 없음). */
export function getChatApprovalRegistry(): ApprovalRegistry {
    registry ??= new ApprovalRegistry();
    return registry;
}

/** 레지스트리의 작업 키 — agent-task 의 taskId 자리에 대화 id 를 접두사와 함께 쓴다. */
export function chatApprovalKey(chatId: string): string {
    return `chat:${chatId}`;
}

/** 이 사용자의 채팅 승인 정책 — 채팅 기본과 조직 하한 중 더 엄격한 쪽(all > high-risk > none). agent-task 라우트·예약 실행과 같은 결합. */
export async function resolveChatApprovalPolicy(userCtx: { userId: string; role?: string }): Promise<TaskSandboxApprovalPolicy> {
    const { approvalPolicyMin } = await resolveEffectivePolicy(userCtx.userId);
    return strictestApprovalPolicy(CHAT_TOOL_APPROVAL.POLICY, approvalPolicyMin) ?? CHAT_TOOL_APPROVAL.POLICY;
}

/** 도구 호출 하나의 승인을 요청하고 결정을 기다린다 — 시간 초과·중단(signal)·정책 none 의 바닥 호출은 거절로 끝난다. */
export function requestChatApproval(p: {
    chatId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    policy: TaskSandboxApprovalPolicy;
    signal?: AbortSignal;
    onPending: (p: PendingApproval) => void;
}): Promise<ApprovalResult> {
    return getChatApprovalRegistry().request(
        { taskId: chatApprovalKey(p.chatId), userId: p.userId, toolName: p.toolName, args: p.args },
        { timeoutMs: CHAT_TOOL_APPROVAL.TIMEOUT_MS, signal: p.signal, onPending: p.onPending, policy: p.policy },
    );
}

/** 대화(요청) 종료 시 레지스트리 정리. 살아 있는 대기는 호출부의 signal 중단이 이미 해소한다. */
export function closeChat(chatId: string): void {
    getChatApprovalRegistry().closeTask(chatApprovalKey(chatId));
}
