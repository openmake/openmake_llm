/**
 * 테스트용 승인자 — 사람이 승인함에서 "승인"을 누르는 것을 실제 ApprovalRegistry 의 list/approve 로 흉내 낸다.
 *
 * 승인 정책 all 은 샌드박스 ON/OFF 와 무관하게 호스트 도구 호출마다 승인을 기다린다(#1469). 승인 경계가 주제가 아닌
 * 작업 루프 테스트는 이 승인자를 켜서 "사용자가 승인했다"는 전제를 명시한다 — 정책을 none 으로 내려 게이트를 끄지 않는다.
 * 질문 도구(ask_human·mcp_elicit)는 승인 대상이 아니라 사람의 답이므로 건드리지 않는다(각 테스트가 직접 답한다).
 *
 * @module __tests__/utils/test-approver
 */
import { getApprovalRegistry } from '../../services/task-sandbox/approval-gate';
import { HITL_ALWAYS_WAIT_TOOLS } from '../../config/tool-policy';

export interface TestApprover {
    /** 지금까지 승인한 도구 이름(승인 순서대로). */
    approved: string[];
    stop(): void;
}

/** userId 의 승인함을 짧은 주기로 살펴 대기 중인 승인을 모두 승인한다. 테스트가 끝나면 stop() 을 부른다. */
export function startTestApprover(userId: string, intervalMs = 2): TestApprover {
    const approved: string[] = [];
    const seen = new Set<string>();
    let busy = false;
    const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        const registry = getApprovalRegistry();
        void registry.list(userId).then(async (pending) => {
            for (const p of pending) {
                if (seen.has(p.approvalId) || HITL_ALWAYS_WAIT_TOOLS.has(p.toolName)) continue;
                seen.add(p.approvalId);
                if (await registry.approve(p.approvalId, `test-approver:${userId}`)) approved.push(p.toolName);
            }
        }).finally(() => { busy = false; });
    }, intervalMs);
    return { approved, stop: () => clearInterval(timer) };
}
