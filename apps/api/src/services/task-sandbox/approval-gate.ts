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

/** 승인이 필요한 고위험 도구(high-risk 정책 시). browser=네트워크 egress.
 *  python_execute 는 임의 코드 실행이라 bash 와 동급 — 제외하면 정책 우회가 된다. */
const HIGH_RISK_TOOLS = new Set(['bash', 'browser', 'python_execute']);
/** 부작용 없는 도구 — 승인 불요(제어 시그널 + 플래닝 + 전문가 자문·병렬 위임).
 *  ask_human 은 이 게이트와 무관하게 TaskRuntime 이 직접 승인 레지스트리로 대기시킨다.
 *  spawn_agents 는 서브 도구를 승인 불요 도구로만 선별(buildTaskSpawnFn)하므로 delegate 와 동급. */
const NO_APPROVAL_TOOLS = new Set(['terminate', 'ask_human', 'plan_create', 'plan_update', 'plan_view', 'delegate', 'spawn_agents']);
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

/** 승인 요청의 해소 결과 — 결정 + (ask_human 자유텍스트 응답 시) 사용자 답변 본문. */
export interface ApprovalResult {
    decision: ApprovalDecision;
    /** answer() 로 해소된 경우에만 채워짐 — ask_human 질문에 대한 사용자 자유텍스트 답변. */
    text?: string;
    /** 승인 대기에 소요된 시간(ms) — pause-aware 타임아웃(4-1)이 총 예산에서 제외하는 데 사용. */
    waitedMs: number;
}

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
    resolve: (r: ApprovalResult) => void;
    timer: NodeJS.Timeout;
}

/**
 * in-memory 대기 승인 레지스트리 (싱글톤). task 백그라운드 프로세스가 request() 로 대기하고
 * REST(approve/reject)가 resolve 한다. 멀티프로세스 정합은 후속(현재 단일 워커 전제).
 */
export class ApprovalRegistry {
    private waiters = new Map<string, Waiter>();
    private seq = 0;
    /** task 자동승인(4-2) — 사용자가 "나머지 모두 승인"을 누른 task 집합. 종료 시 해제. */
    private autoApproveTasks = new Set<string>();

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
     * task 자동승인 설정(4-2) — 이후 이 task 의 승인 요청은 즉시 approved 로 해소된다.
     * ⚠️ ask_human 은 제외(질문의 목적 자체가 사람 응답). 현재 대기 중인 동일 task 의
     * 승인들도 즉시 해소한다. task 종료 시 clearAutoApprove 로 해제(잔존 방지).
     */
    setAutoApprove(taskId: string, enabled: boolean): void {
        if (!enabled) { this.autoApproveTasks.delete(taskId); return; }
        this.autoApproveTasks.add(taskId);
        for (const w of [...this.waiters.values()]) {
            if (w.pending.taskId === taskId && w.pending.toolName !== 'ask_human') {
                w.resolve({ decision: 'approved', waitedMs: Date.now() - w.pending.createdAt });
            }
        }
        logger.info(`[${taskId}] 자동승인 활성 — 이후 도구 호출은 승인 없이 진행 (ask_human 제외)`);
    }

    isAutoApprove(taskId: string): boolean { return this.autoApproveTasks.has(taskId); }

    clearAutoApprove(taskId: string): void { this.autoApproveTasks.delete(taskId); }

    /**
     * 승인을 요청하고 결정(approved/rejected)을 await. timeout/abort 시 'rejected'.
     * onPending 콜백으로 호출부가 알림(web-push/WS)·상태('paused')를 발행한다.
     * 자동승인 task(ask_human 제외)는 대기 없이 즉시 approved.
     */
    request(
        input: { taskId: string; userId: string; toolName: string; args: Record<string, unknown> },
        opts: { timeoutMs: number; signal?: AbortSignal; onPending?: (p: PendingApproval) => void },
    ): Promise<ApprovalResult> {
        if (this.autoApproveTasks.has(input.taskId) && input.toolName !== 'ask_human') {
            return Promise.resolve({ decision: 'approved', waitedMs: 0 });
        }
        const approvalId = `apv_${input.taskId}_${this.seq++}`;
        const pending: PendingApproval = { approvalId, ...input, createdAt: Date.now() };
        return new Promise<ApprovalResult>((resolvePromise) => {
            const settle = (r: Omit<ApprovalResult, 'waitedMs'>) => {
                const w = this.waiters.get(approvalId);
                if (!w) return;
                clearTimeout(w.timer);
                this.waiters.delete(approvalId);
                if (r.decision === 'rejected') logger.info(`[${input.taskId}] 승인 거절/만료: ${input.toolName}`);
                resolvePromise({ ...r, waitedMs: Date.now() - pending.createdAt });
            };
            const timer = setTimeout(() => settle({ decision: 'rejected' }), opts.timeoutMs);
            this.waiters.set(approvalId, { pending, resolve: (r) => settle(r), timer });
            if (opts.signal) {
                if (opts.signal.aborted) { settle({ decision: 'rejected' }); return; }
                opts.signal.addEventListener('abort', () => settle({ decision: 'rejected' }), { once: true });
            }
            opts.onPending?.(pending);
        });
    }

    /** REST 승인 — owner 검증은 호출부 책임. 성공 시 true. */
    approve(approvalId: string): boolean {
        const w = this.waiters.get(approvalId);
        if (!w) return false;
        w.resolve({ decision: 'approved', waitedMs: Date.now() - w.pending.createdAt });
        return true;
    }

    /** REST 거절. */
    reject(approvalId: string): boolean {
        const w = this.waiters.get(approvalId);
        if (!w) return false;
        w.resolve({ decision: 'rejected', waitedMs: Date.now() - w.pending.createdAt });
        return true;
    }

    /**
     * REST 자유텍스트 답변 — ask_human 질문에 사용자가 텍스트로 응답. 진행(approved)으로
     * 해소하되 답변 본문을 함께 전달해 에이전트가 실제 답을 받아 이어가게 한다.
     * (승인 게이트가 아닌 ask_human 대기에만 의미 있음 — 호출부가 owner 검증.)
     */
    answer(approvalId: string, text: string): boolean {
        const w = this.waiters.get(approvalId);
        if (!w) return false;
        w.resolve({ decision: 'approved', text, waitedMs: Date.now() - w.pending.createdAt });
        return true;
    }
}

let registry: ApprovalRegistry | null = null;
export function getApprovalRegistry(): ApprovalRegistry {
    if (!registry) registry = new ApprovalRegistry();
    return registry;
}
