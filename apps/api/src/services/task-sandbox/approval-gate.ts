/**
 * ============================================================
 * Task Tool Approval Gate — HITL 승인 게이트 (Manus화 Phase 1 / C1)
 * ============================================================
 *
 * 자율 에이전트가 영속 샌드박스 도구(셸/파일/네트워크)를 실행하기 전, 정책에 따라
 * 사용자 승인을 요구한다. 정책 'all'(기본)은 모든 도구 호출을 승인 대기시킨다.
 *
 * `AgentTaskService.ts:296` 이 예고한 "write 도구 추가 시 gate 필요"를 충족한다.
 * resume(이어하기)는 continuation 일 뿐 승인 게이트가 아니었으므로 신규 구축.
 *
 * 구조: in-loop 대기 — task 는 in-memory 장수 백그라운드 프로세스이므로, 도구 실행 직전
 * Promise 로 승인을 await 한다(timeout/abort 시 자동 거절). 승인은 REST 가 resolve.
 *
 * @module services/task-sandbox/approval-gate
 */
import type { TaskSandboxApprovalPolicy } from '../../config/task-sandbox';
import { createLogger } from '../../utils/logger';

const logger = createLogger('TaskApprovalGate');

/** 승인이 필요한 고위험 도구(high-risk 정책 시). browser=네트워크 egress. */
const HIGH_RISK_TOOLS = new Set(['bash', 'browser']);
/** 부작용 없는 도구 — 승인 불요(제어 시그널 + 플래닝 + 전문가 자문). */
const NO_APPROVAL_TOOLS = new Set(['terminate', 'ask_human', 'plan_create', 'plan_update', 'plan_view', 'delegate']);
/** 고위험으로 보는 file_ops 작업. */
const HIGH_RISK_FILE_OPS = new Set(['delete']);

/** PURE: 도구 호출이 승인을 요구하는지 정책에 따라 판정. */
export function requiresApproval(
    policy: TaskSandboxApprovalPolicy,
    toolName: string,
    args: Record<string, unknown>,
): boolean {
    if (policy === 'none') return false;
    // 제어 시그널·플래닝은 승인 불요(부작용 없음).
    if (NO_APPROVAL_TOOLS.has(toolName)) return false;
    if (policy === 'all') return true;
    // high-risk
    if (HIGH_RISK_TOOLS.has(toolName)) return true;
    if (toolName === 'file_ops' && HIGH_RISK_FILE_OPS.has(String(args.op))) return true;
    return false;
}

export type ApprovalDecision = 'approved' | 'rejected';

export interface PendingApproval {
    approvalId: string;
    taskId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    createdAt: number;
}

interface Waiter {
    pending: PendingApproval;
    resolve: (d: ApprovalDecision) => void;
    timer: NodeJS.Timeout;
}

/**
 * in-memory 대기 승인 레지스트리 (싱글톤). task 백그라운드 프로세스가 request() 로 대기하고
 * REST(approve/reject)가 resolve 한다. 멀티프로세스 정합은 후속(현재 단일 워커 전제).
 */
export class ApprovalRegistry {
    private waiters = new Map<string, Waiter>();
    private seq = 0;

    /** 대기 중인 승인 요청 — owner user 의 task 일시정지 UI/REST 가 조회. */
    list(userId: string): PendingApproval[] {
        return [...this.waiters.values()]
            .map((w) => w.pending)
            .filter((p) => p.userId === userId);
    }

    get(approvalId: string): PendingApproval | undefined {
        return this.waiters.get(approvalId)?.pending;
    }

    /**
     * 승인을 요청하고 결정(approved/rejected)을 await. timeout/abort 시 'rejected'.
     * onPending 콜백으로 호출부가 알림(web-push/WS)·상태('paused')를 발행한다.
     */
    request(
        input: { taskId: string; userId: string; toolName: string; args: Record<string, unknown> },
        opts: { timeoutMs: number; signal?: AbortSignal; onPending?: (p: PendingApproval) => void },
    ): Promise<ApprovalDecision> {
        const approvalId = `apv_${input.taskId}_${this.seq++}`;
        const pending: PendingApproval = { approvalId, ...input, createdAt: 0 };
        return new Promise<ApprovalDecision>((resolvePromise) => {
            const settle = (d: ApprovalDecision) => {
                const w = this.waiters.get(approvalId);
                if (!w) return;
                clearTimeout(w.timer);
                this.waiters.delete(approvalId);
                if (d === 'rejected') logger.info(`[${input.taskId}] 승인 거절/만료: ${input.toolName}`);
                resolvePromise(d);
            };
            const timer = setTimeout(() => settle('rejected'), opts.timeoutMs);
            this.waiters.set(approvalId, { pending, resolve: settle, timer });
            if (opts.signal) {
                if (opts.signal.aborted) { settle('rejected'); return; }
                opts.signal.addEventListener('abort', () => settle('rejected'), { once: true });
            }
            opts.onPending?.(pending);
        });
    }

    /** REST 승인 — owner 검증은 호출부 책임. 성공 시 true. */
    approve(approvalId: string): boolean {
        const w = this.waiters.get(approvalId);
        if (!w) return false;
        w.resolve('approved');
        return true;
    }

    /** REST 거절. */
    reject(approvalId: string): boolean {
        const w = this.waiters.get(approvalId);
        if (!w) return false;
        w.resolve('rejected');
        return true;
    }
}

let registry: ApprovalRegistry | null = null;
export function getApprovalRegistry(): ApprovalRegistry {
    if (!registry) registry = new ApprovalRegistry();
    return registry;
}
