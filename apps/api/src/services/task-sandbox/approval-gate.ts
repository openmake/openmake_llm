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
import { isSensitivePath } from './sensitive-paths';
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { classifyToolRisk, policyRequiresApproval, type ToolRiskClass } from '../../config/tool-policy';
import { AgentTaskApprovalRepository, hashApprovalArgs, type ApprovalRow } from '../../data/repositories/agent-task-approval-repository';

const logger = createLogger('TaskApprovalGate');

/** 파일을 바꾸는 작업 — 대상이 자격증명 파일이면 high-risk 로 올린다(아래 판정). */
const FILE_WRITE_OPS = new Set(['write', 'delete']);
const EDITOR_WRITE_COMMANDS = new Set(['create', 'str_replace', 'insert']);
/** 디바이스(로컬 브리지)가 실행 직전 자체 확인하는 코드 실행 도구 — 서버 승인 중복이라 skip 대상. */
const DEVICE_GATED_SHELL = new Set(['bash', 'python_execute']);

/** PURE: 도구 호출이 승인을 요구하는지 정책에 따라 판정 — 규칙은 config/tool-policy 의 위험 등급표
 *  (종전 이름 목록 HIGH_RISK_TOOLS/NO_APPROVAL_TOOLS 를 등급 × 정책으로 대체, 판정 결과는 동일).
 *  opts.deviceGatesShell=true(로컬 브리지 실행)면 exec 계열(bash/python_execute)은 디바이스가
 *  실행 직전 사용자 확인을 강제하므로 서버측 승인을 skip 한다(이중 프롬프트 제거). 파일/기타
 *  도구는 디바이스가 다이얼로그를 띄우지 않으므로 정책대로 서버 승인을 유지한다.
 *  자격증명 파일 쓰기(isSensitiveWrite)는 high-risk 에서도 승인 — 종전엔 `.env`·키 파일 덮어쓰기가
 *  서버 승인도 디바이스 확인도 없이 통과했다(로컬 브리지의 write kind 는 confirmExec 대상이 아니다). */
export function requiresApproval(
    policy: TaskSandboxApprovalPolicy,
    toolName: string,
    args: Record<string, unknown>,
    opts: { deviceGatesShell?: boolean } = {},
): boolean {
    if (opts.deviceGatesShell && DEVICE_GATED_SHELL.has(toolName)) return false;
    return policyRequiresApproval(policy, classifyToolRisk(toolName, args), isSensitiveWrite(toolName, args));
}

/** PURE: 이 호출이 자격증명 파일을 바꾸려 하는가. args 미지({})면 false(보수 판정 — 강등 계산과 동일 계약). */
export function isSensitiveWrite(toolName: string, args: Record<string, unknown>): boolean {
    if (toolName === 'file_ops') return FILE_WRITE_OPS.has(String(args.op)) && isSensitivePath(args.path);
    if (toolName === 'str_replace_editor') return EDITOR_WRITE_COMMANDS.has(String(args.command)) && isSensitivePath(args.path);
    return false;
}

type ApprovalDecision = 'approved' | 'rejected';
/** 거절 사유 — 'timeout'(무응답 만료) 은 사용자 부재 신호로, 명시 거절('user')과 달리
 *  HITL 무응답 강등(연속 N회 시 승인 필요 도구 제거 → 산출물 유도)의 카운트 대상이다. */
export type ApprovalRejectReason = 'timeout' | 'user' | 'abort';

/** 승인 요청의 해소 결과 — 결정 + (ask_human 자유텍스트 응답 시) 사용자 답변 본문. */
interface ApprovalResult {
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
    /** 위험 등급(config/tool-policy) — 승인함이 "왜 승인이 필요한지"를 보여 주는 근거(125). */
    riskClass: ToolRiskClass;
    /** 자격증명 파일을 바꾸는 호출(high-risk 상향 사유). */
    sensitive: boolean;
}

interface Waiter {
    pending: PendingApproval;
    resolve: (r: ApprovalResult) => void;
    timer: NodeJS.Timeout;
}

/** 영속 저장소 계약(124) — 테스트는 생략(메모리만), 운영은 AgentTaskApprovalRepository. */
export type ApprovalStore = Pick<AgentTaskApprovalRepository,
    'insertPending' | 'markDecided' | 'listPending' | 'getPending' | 'takeoverForCall' | 'expirePendingForTask'>;

function rowToPending(r: ApprovalRow): PendingApproval {
    const args = r.args ?? {};
    return {
        approvalId: r.approval_id, taskId: r.task_id, userId: r.user_id, toolName: r.tool_name, args,
        createdAt: new Date(r.created_at).getTime(),
        riskClass: (r.risk_class as ToolRiskClass | null) ?? classifyToolRisk(r.tool_name, args),
        sensitive: isSensitiveWrite(r.tool_name, args),
    };
}

/**
 * 대기 승인 레지스트리 (싱글톤). task 백그라운드 프로세스가 request() 로 대기하고
 * REST(approve/reject)가 resolve 한다. 메모리 waiter 가 실행 중 대기의 SoT 이고, 저장소(124)는
 * 그 그림자다 — 프로세스가 내려가도 승인함에 pending 이 남고, 그때 내린 결정은 재개된 작업이
 * 같은 호출을 다시 요청할 때 이어받는다. 저장소 오류는 전부 삼킨다(fail-open).
 */
export class ApprovalRegistry {
    private waiters = new Map<string, Waiter>();
    private seq = 0;
    /** task 자동승인(4-2) — 사용자가 "나머지 모두 승인"을 누른 task 집합. 종료 시 해제. */
    private autoApproveTasks = new Set<string>();

    constructor(private readonly store?: ApprovalStore) {}

    private async persist<T>(fn: (s: ApprovalStore) => Promise<T>): Promise<T | undefined> {
        if (!this.store) return undefined;
        try { return await fn(this.store); } catch (e) {
            logger.warn(`승인 영속 실패(무시): ${e instanceof Error ? e.message : e}`);
            return undefined;
        }
    }

    /** 대기 중인 승인 요청 — 메모리 waiter + 저장소의 살아 있는 pending(프로세스가 내려간 작업분). */
    async list(userId: string): Promise<PendingApproval[]> {
        const live = [...this.waiters.values()].map((w) => w.pending).filter((p) => p.userId === userId);
        const rows = (await this.persist((s) => s.listPending(userId))) ?? [];
        const seen = new Set(live.map((p) => p.approvalId));
        return [...live, ...rows.filter((r) => !seen.has(r.approval_id)).map(rowToPending)];
    }

    async get(approvalId: string): Promise<PendingApproval | undefined> {
        const live = this.waiters.get(approvalId)?.pending;
        if (live) return live;
        const row = await this.persist((s) => s.getPending(approvalId));
        return row ? rowToPending(row) : undefined;
    }

    /**
     * task 자동승인 설정(4-2) — 이후 이 task 의 승인 요청은 즉시 approved 로 해소된다.
     * ⚠️ ask_human 은 제외(질문의 목적 자체가 사람 응답). 현재 대기 중인 동일 task 의
     * 승인들도 즉시 해소한다. task 종료 시 clearAutoApprove 로 해제(잔존 방지).
     */
    setAutoApprove(taskId: string, enabled: boolean): void {
        if (!enabled) { this.autoApproveTasks.delete(taskId); return; }
        this.autoApproveTasks.add(taskId);
        // 살아 있는 waiter 는 아래서 즉시 해소되고, 저장소의 pending 도 승인으로 닫는다(승인함 잔존 방지).
        void this.persist(async (s) => {
            for (const r of await s.listPending([...this.waiters.values()].find((w) => w.pending.taskId === taskId)?.pending.userId ?? '')) {
                if (r.task_id === taskId && r.tool_name !== 'ask_human') await s.markDecided(r.approval_id, 'approved');
            }
        });
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
    async request(
        input: { taskId: string; userId: string; toolName: string; args: Record<string, unknown> },
        opts: { timeoutMs: number; signal?: AbortSignal; onPending?: (p: PendingApproval) => void },
    ): Promise<ApprovalResult> {
        if (this.autoApproveTasks.has(input.taskId) && input.toolName !== 'ask_human') {
            return { decision: 'approved', waitedMs: 0 };
        }
        // 재시작 후 이어받기(124): 같은 호출에 이미 내려진 결정이 있으면 대기 없이 소비하고,
        // 살아 있는 pending 이 있으면 그 id 를 그대로 써서 승인함의 항목이 바뀌지 않게 한다.
        const argsHash = hashApprovalArgs(input.args);
        // 저장소가 없으면(테스트·비영속) 대기 등록까지 동기적으로 끝낸다 — 호출 직후 list() 가 보이도록.
        const prior = this.store ? await this.persist((s) => s.takeoverForCall(input.taskId, input.toolName, argsHash)) : undefined;
        if (prior && prior.status !== 'pending') {
            logger.info(`[${input.taskId}] 재시작 전 결정 이어받음(${prior.status}): ${input.toolName}`);
            return prior.status === 'approved'
                ? { decision: 'approved', waitedMs: 0, ...(prior.answer_text ? { text: prior.answer_text } : {}) }
                : { decision: 'rejected', reason: 'user', waitedMs: 0 };
        }
        const approvalId = prior?.approval_id ?? `apv_${input.taskId}_${Date.now().toString(36)}_${this.seq++}`;
        const riskClass = classifyToolRisk(input.toolName, input.args);
        const pending: PendingApproval = {
            approvalId, ...input, createdAt: prior ? new Date(prior.created_at).getTime() : Date.now(),
            riskClass, sensitive: isSensitiveWrite(input.toolName, input.args),
        };
        if (!prior && this.store) await this.persist((s) => s.insertPending({ approvalId, ...input, argsHash, riskClass, timeoutMs: opts.timeoutMs }));
        return new Promise<ApprovalResult>((resolvePromise) => {
            const settle = (r: Omit<ApprovalResult, 'waitedMs'>) => {
                const w = this.waiters.get(approvalId);
                if (!w) return;
                clearTimeout(w.timer);
                this.waiters.delete(approvalId);
                if (r.decision === 'rejected') logger.info(`[${input.taskId}] 승인 거절/만료(${r.reason}): ${input.toolName}`);
                void this.persist((s) => s.markDecided(approvalId,
                    r.decision === 'approved' ? 'approved' : r.reason === 'timeout' ? 'expired' : r.reason === 'abort' ? 'aborted' : 'rejected',
                    r.text));
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

    /** 메모리 waiter 가 없으면(프로세스 재시작으로 작업이 내려간 상태) 저장소 pending 행에 결정만 남긴다 —
     *  재개된 작업이 같은 호출을 다시 요청할 때 takeoverForCall 로 소비한다. */
    private settleOrPersist(approvalId: string, r: Omit<ApprovalResult, 'waitedMs'>): Promise<boolean> {
        const w = this.waiters.get(approvalId);
        if (w) { w.resolve({ ...r, waitedMs: Date.now() - w.pending.createdAt }); return Promise.resolve(true); }
        return this.persist((s) => s.markDecided(approvalId, r.decision === 'approved' ? 'approved' : 'rejected', r.text))
            .then((ok) => ok === true);
    }

    /** REST 승인 — owner 검증은 호출부 책임. 성공 시 true. */
    approve(approvalId: string): Promise<boolean> {
        return this.settleOrPersist(approvalId, { decision: 'approved' });
    }

    /** REST 거절. */
    reject(approvalId: string): Promise<boolean> {
        return this.settleOrPersist(approvalId, { decision: 'rejected', reason: 'user' });
    }

    /**
     * REST 자유텍스트 답변 — ask_human 질문에 사용자가 텍스트로 응답. 진행(approved)으로
     * 해소하되 답변 본문을 함께 전달해 에이전트가 실제 답을 받아 이어가게 한다.
     * (승인 게이트가 아닌 ask_human 대기에만 의미 있음 — 호출부가 owner 검증.)
     */
    answer(approvalId: string, text: string): Promise<boolean> {
        return this.settleOrPersist(approvalId, { decision: 'approved', text });
    }

    /** 작업 종료 시 저장소에 남은 pending 정리(124) — 메모리 waiter 는 signal abort 가 이미 해소했다. */
    closeTask(taskId: string): void {
        this.autoApproveTasks.delete(taskId);
        void this.persist((s) => s.expirePendingForTask(taskId));
    }
}

let registry: ApprovalRegistry | null = null;
export function getApprovalRegistry(): ApprovalRegistry {
    if (!registry) {
        // 저장소는 첫 사용 때 만든다 — DB 풀이 아직 없거나(부팅 순서·테스트 mock) 실패하면 persist 가 삼킨다.
        let repo: AgentTaskApprovalRepository | null = null;
        const lazy = (): AgentTaskApprovalRepository => (repo ??= new AgentTaskApprovalRepository(getPool()));
        registry = new ApprovalRegistry({
            insertPending: (r) => lazy().insertPending(r),
            markDecided: (id, s, t) => lazy().markDecided(id, s, t),
            listPending: (u) => lazy().listPending(u),
            getPending: (id) => lazy().getPending(id),
            takeoverForCall: (t, n, h) => lazy().takeoverForCall(t, n, h),
            expirePendingForTask: (t, s) => lazy().expirePendingForTask(t, s),
        });
    }
    return registry;
}
