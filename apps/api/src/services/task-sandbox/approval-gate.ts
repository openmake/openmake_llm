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
 *  python_execute 는 임의 코드 실행이라 bash 와 동급 — 제외하면 정책 우회가 된다.
 *  skill_run 은 저장된 브라우저/스크립트 절차를 그대로 실행하므로 bash/browser 와 동급(제외 시 우회). */
const HIGH_RISK_TOOLS = new Set(['bash', 'browser', 'python_execute', 'skill_run']);
/** 부작용 없는 도구 — 승인 불요(제어 시그널 + 플래닝 + 전문가 자문·병렬 위임).
 *  ask_human 은 이 게이트와 무관하게 TaskRuntime 이 직접 승인 레지스트리로 대기시킨다.
 *  spawn_agents 는 서브 도구를 승인 불요 도구로만 선별(buildTaskSpawnFn)하므로 delegate 와 동급. */
const NO_APPROVAL_TOOLS = new Set(['terminate', 'ask_human', 'plan_create', 'plan_update', 'plan_view', 'delegate', 'spawn_agents']);
/** 고위험으로 보는 file_ops 작업. */
const HIGH_RISK_FILE_OPS = new Set(['delete']);
/** 디바이스(로컬 브리지)가 실행 직전 자체 확인하는 코드 실행 도구 — 서버 승인 중복이라 skip 대상. */
const DEVICE_GATED_SHELL = new Set(['bash', 'python_execute']);

/** PURE: 도구 호출이 승인을 요구하는지 정책에 따라 판정.
 *  opts.deviceGatesShell=true(로컬 브리지 실행)면 exec 계열(bash/python_execute)은 디바이스가
 *  실행 직전 사용자 확인을 강제하므로 서버측 승인을 skip 한다(이중 프롬프트 제거). 파일/기타
 *  도구는 디바이스가 다이얼로그를 띄우지 않으므로 정책대로 서버 승인을 유지한다. */
export function requiresApproval(
    policy: TaskSandboxApprovalPolicy,
    toolName: string,
    args: Record<string, unknown>,
    opts: { deviceGatesShell?: boolean } = {},
): boolean {
    if (policy === 'none') return false;
    // 제어 시그널·플래닝은 승인 불요(부작용 없음).
    if (NO_APPROVAL_TOOLS.has(toolName)) return false;
    // 로컬 브리지: 코드 실행은 디바이스가 게이트 → 서버 승인 중복 제거.
    if (opts.deviceGatesShell && DEVICE_GATED_SHELL.has(toolName)) return false;
    if (policy === 'all') return true;
    // high-risk
    if (HIGH_RISK_TOOLS.has(toolName)) return true;
    if (toolName === 'file_ops' && HIGH_RISK_FILE_OPS.has(String(args.op))) return true;
    return false;
}

export type ApprovalDecision = 'approved' | 'rejected';
/** 거절 사유 — 'timeout'(무응답 만료) 은 사용자 부재 신호로, 명시 거절('user')과 달리
 *  HITL 무응답 강등(연속 N회 시 승인 필요 도구 제거 → 산출물 유도)의 카운트 대상이다. */
export type ApprovalRejectReason = 'timeout' | 'user' | 'abort';

/** 승인 요청의 해소 결과 — 결정 + (ask_human 자유텍스트 응답 시) 사용자 답변 본문. */
export interface ApprovalResult {
    decision: ApprovalDecision;
    /** rejected 인 경우에만 채워짐 — 무응답 만료/명시 거절/실행 중단 구분. */
    reason?: ApprovalRejectReason;
    /** answer() 로 해소된 경우에만 채워짐 — ask_human 질문에 대한 사용자 자유텍스트 답변. */
    text?: string;
    /** 승인 대기에 소요된 시간(ms) — pause-aware 타임아웃(4-1)이 총 예산에서 제외하는 데 사용. */
    waitedMs: number;
}

/**
 * PURE: HITL 무응답 강등 — 승인을 요구할 도구(+승인 정책과 무관하게 항상 사람을 기다리는
 * ask_human)를 도구 세트에서 제거한다. 사용자 부재 시 남은 턴을 승인 불요 경로로 강제해
 * "대기→만료 반복으로 예산만 소진하고 산출물 0" 대신 확보한 정보로 마무리하게 한다.
 * ⚠️ args 미지 상태의 보수 판정({}) — high-risk 정책의 file_ops(delete 만 승인 대상)처럼
 * 인자 의존 도구는 남는다(해당 호출은 여전히 게이트에서 거절되고, 강등 nudge 가 우회를 지시).
 */
export function stripApprovalGatedTools<T extends { function: { name: string } }>(
    tools: T[],
    policy: TaskSandboxApprovalPolicy,
    opts: { deviceGatesShell?: boolean } = {},
): T[] {
    return tools.filter((t) => t.function.name !== 'ask_human'
        && !requiresApproval(policy, t.function.name, {}, opts));
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
                if (r.decision === 'rejected') logger.info(`[${input.taskId}] 승인 거절/만료(${r.reason}): ${input.toolName}`);
                resolvePromise({ ...r, waitedMs: Date.now() - pending.createdAt });
            };
            const timer = setTimeout(() => settle({ decision: 'rejected', reason: 'timeout' }), opts.timeoutMs);
            this.waiters.set(approvalId, { pending, resolve: (r) => settle(r), timer });
            if (opts.signal) {
                if (opts.signal.aborted) { settle({ decision: 'rejected', reason: 'abort' }); return; }
                opts.signal.addEventListener('abort', () => settle({ decision: 'rejected', reason: 'abort' }), { once: true });
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
        w.resolve({ decision: 'rejected', reason: 'user', waitedMs: Date.now() - w.pending.createdAt });
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
