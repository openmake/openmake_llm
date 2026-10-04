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
import { redactApprovalArgs, redactApprovalPreview } from './approval-redact';
import { approvalFloorReason, writeTargetPath } from './approval-floor';
import { createLogger } from '../../utils/logger';
import { getPool } from '../../data/models/unified-database';
import { classifyToolRisk, policyRequiresApproval, isThirdPartyTool, HITL_ALWAYS_WAIT_TOOLS, type ToolRiskClass } from '../../config/tool-policy';
import { AgentTaskApprovalRepository, hashApprovalArgs, type ApprovalRow } from '../../data/repositories/agent-task-approval-repository';
import { getConfig } from '../../config/env';
import { AGENT_TASK_LIMITS, APPROVAL_RECENT_WINDOW_MS } from '../../config/runtime-limits';
import { UNATTENDED_APPROVAL_OUTCOME, resolveUnattendedOutcome } from '../../config/agent-task-approval';

const logger = createLogger('TaskApprovalGate');

/** 디바이스(로컬 브리지)가 실행 직전 자체 확인하는 코드 실행 도구 — 서버 승인 중복이라 skip 대상. */
const DEVICE_GATED_SHELL = new Set(['bash', 'python_execute']);

/** PURE: 도구 호출이 승인을 요구하는지 정책에 따라 판정 — 규칙은 config/tool-policy 의 위험 등급표
 *  (종전 이름 목록 HIGH_RISK_TOOLS/NO_APPROVAL_TOOLS 를 등급 × 정책으로 대체, 판정 결과는 동일).
 *  opts.deviceGatesShell=true(로컬 브리지 실행)면 exec 계열(bash/python_execute)은 디바이스가
 *  실행 직전 사용자 확인을 강제하므로 서버측 승인을 skip 한다(이중 프롬프트 제거). 파일/기타
 *  도구는 디바이스가 다이얼로그를 띄우지 않으므로 정책대로 서버 승인을 유지한다.
 *  자격증명 파일 쓰기(isSensitiveWrite)는 high-risk 에서도 승인 — 종전엔 `.env`·키 파일 덮어쓰기가
 *  서버 승인도 디바이스 확인도 없이 통과했다(로컬 브리지의 write kind 는 confirmExec 대상이 아니다).
 *  바닥 호출(approval-floor — 지시 파일 쓰기 포함)도 high-risk 에서 승인한다: 자동승인에서도 묻는 호출이 정책에서 빠지면 안 된다.
 *  사용자 메모리 쓰기(memory_write)는 정책 none 에서도 승인한다 — 사람이 문장을 보지 않은 채 메모리에 남는 길을 두지 않는다. */
export function requiresApproval(
    policy: TaskSandboxApprovalPolicy,
    toolName: string,
    args: Record<string, unknown>,
    opts: { deviceGatesShell?: boolean } = {},
): boolean {
    if (opts.deviceGatesShell && DEVICE_GATED_SHELL.has(toolName)) return false;
    const floor = approvalFloorReason(toolName, args);
    if (floor === 'memory_write' || floor === 'site_write') return true;
    return policyRequiresApproval(policy, classifyToolRisk(toolName, args),
        isSensitiveWrite(toolName, args) || floor !== null, isThirdPartyTool(toolName));
}

/** PURE: 이 호출이 자격증명 파일을 바꾸려 하는가. args 미지({})면 false(보수 판정 — 강등 계산과 동일 계약). */
export function isSensitiveWrite(toolName: string, args: Record<string, unknown>): boolean {
    const target = writeTargetPath(toolName, args);
    return target !== null && isSensitivePath(target);
}

type ApprovalDecision = 'approved' | 'rejected';
/** 거절 사유 — 'timeout'(무응답 만료) 은 사용자 부재 신호로, 명시 거절('user')과 달리
 *  HITL 무응답 강등(연속 N회 시 승인 필요 도구 제거 → 산출물 유도)의 카운트 대상이다.
 *  'parked'(F16.7): 질문형 승인이 만료됐지만 AGENT_TASK_HITL_PARK_ON_TIMEOUT 이라 저장소에 pending 으로 남긴 경우 —
 *  호출부는 작업을 주차(AgentTaskParked)하고, 답이 오면 재개된 작업이 같은 호출에서 결정을 이어받는다.
 *  'unattended': 무인 작업(예약 실행)이라 기다리지 않고 설정된 결론으로 끝낸 경우 — 사용자의 거절이 아니다. */
export type ApprovalRejectReason = 'timeout' | 'user' | 'abort' | 'parked' | 'unattended';

/** 승인 요청의 해소 결과 — 결정 + (ask_human 자유텍스트 응답 시) 사용자 답변 본문. */
interface ApprovalResult {
    decision: ApprovalDecision;
    /** rejected 인 경우에만 채워짐 — 무응답 만료/명시 거절/실행 중단 구분. */
    reason?: ApprovalRejectReason;
    /** answer() 로 해소되면 ask_human 질문에 대한 사용자 자유텍스트 답변, 사유를 적은 거절이면 그 사유. */
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
    return tools.filter((t) => !HITL_ALWAYS_WAIT_TOOLS.has(t.function.name)
        && !requiresApproval(policy, t.function.name, {}, opts));
}

export interface PendingApproval {
    approvalId: string;
    taskId: string;
    userId: string;
    toolName: string;
    /** 승인함에 보이는 사본 — 비밀 값은 가려져 있다(approval-redact). 실행은 호출부가 가진 원래 인자로 한다. */
    args: Record<string, unknown>;
    createdAt: number;
    /** 위험 등급(config/tool-policy) — 승인함이 "왜 승인이 필요한지"를 보여 주는 근거(125). */
    riskClass: ToolRiskClass;
    /** 자격증명 파일을 바꾸는 호출(high-risk 상향 사유). */
    sensitive: boolean;
    /** 실행 전 미리보기(unified diff, 138) — 파일 도구 외 undefined */
    preview?: string;
    /** 현재 담당자(138) — 없으면 소유자(userId). 이관·에스컬레이션으로 바뀐다 */
    assigneeUserId?: string;
}

interface Waiter {
    pending: PendingApproval;
    resolve: (r: ApprovalResult) => void;
    timer: NodeJS.Timeout;
    /** 자동승인에서도 묻는 바닥 호출(approval-floor) — 요청 시점의 원래 인자로 판정해 둔다. */
    floor: boolean;
}

/** 영속 저장소 계약(124) — 테스트는 생략(메모리만), 운영은 AgentTaskApprovalRepository. */
export type ApprovalStore = Pick<AgentTaskApprovalRepository,
    'insertPending' | 'markDecided' | 'listPending' | 'getPending' | 'takeoverForCall' | 'expirePendingForTask'>
    & Partial<Pick<AgentTaskApprovalRepository, 'revokeUnconsumed' | 'listRecentDecisions' | 'recordEvent' | 'reassign' | 'extendPending'>>;

function rowToPending(r: ApprovalRow): PendingApproval {
    const args = r.args ?? {};
    return {
        approvalId: r.approval_id, taskId: r.task_id, userId: r.user_id, toolName: r.tool_name, args,
        createdAt: new Date(r.created_at).getTime(),
        riskClass: (r.risk_class as ToolRiskClass | null) ?? classifyToolRisk(r.tool_name, args),
        sensitive: isSensitiveWrite(r.tool_name, args),
        ...(r.preview ? { preview: r.preview } : {}),
        ...(r.assignee_user_id ? { assigneeUserId: r.assignee_user_id } : {}),
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
    /** 무인 작업(예약 실행) — 승인할 사람이 없어 승인 요청을 기다리지 않고 설정된 결론으로 끝낸다. 메모리뿐이라 재시작 뒤 재개분은 종전처럼 기다린다. */
    private unattendedTasks = new Set<string>();

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
        // 담당자(138)가 있으면 그 사람의 승인함에, 없으면 소유자의 승인함에 — 저장소 listPending 과 같은 규칙
        const live = [...this.waiters.values()].map((w) => w.pending).filter((p) => (p.assigneeUserId ?? p.userId) === userId);
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
     * ⚠️ ask_human·mcp_elicit(HITL_ALWAYS_WAIT_TOOLS)은 제외(질문의 목적 자체가 사람 응답). 바닥 호출(approval-floor —
     * 자격증명 파일 쓰기·외부 MCP 도구)도 제외 — 전체 허용에서도 계속 묻는다. 현재 대기 중인 동일 task 의
     * 승인들도 즉시 해소한다. task 종료 시 clearAutoApprove 로 해제(잔존 방지).
     */
    setAutoApprove(taskId: string, enabled: boolean): void {
        if (!enabled) { this.autoApproveTasks.delete(taskId); return; }
        this.autoApproveTasks.add(taskId);
        // 살아 있는 waiter 는 아래서 즉시 해소되고, 저장소의 pending 도 승인으로 닫는다(승인함 잔존 방지).
        void this.persist(async (s) => {
            for (const r of await s.listPending([...this.waiters.values()].find((w) => w.pending.taskId === taskId)?.pending.userId ?? '')) {
                if (r.task_id === taskId && !HITL_ALWAYS_WAIT_TOOLS.has(r.tool_name) && approvalFloorReason(r.tool_name, r.args ?? {}) === null) await s.markDecided(r.approval_id, 'approved');
            }
        });
        for (const w of [...this.waiters.values()]) {
            if (w.pending.taskId === taskId && !HITL_ALWAYS_WAIT_TOOLS.has(w.pending.toolName) && !w.floor) {
                w.resolve({ decision: 'approved', waitedMs: Date.now() - w.pending.createdAt });
            }
        }
        logger.info(`[${taskId}] 자동승인 활성 — 이후 도구 호출은 승인 없이 진행 (ask_human·mcp_elicit·바닥 호출 제외)`);
    }

    isAutoApprove(taskId: string): boolean { return this.autoApproveTasks.has(taskId); }

    /** 무인 작업 표시 — 예약 실행이 시작 전에 켠다. 작업 종료(closeTask) 때 풀린다. */
    setUnattended(taskId: string, enabled: boolean): void {
        if (enabled) this.unattendedTasks.add(taskId); else this.unattendedTasks.delete(taskId);
    }

    /** 이 호출이 자동승인으로 대기 없이 통과하는가 — 바닥 검사가 전체 허용보다 먼저다. 선실행·서브 도구 선별도 이 판정을 쓴다. */
    autoApproves(taskId: string, toolName: string, args: Record<string, unknown>): boolean {
        return this.autoApproveTasks.has(taskId) && !HITL_ALWAYS_WAIT_TOOLS.has(toolName) && approvalFloorReason(toolName, args) === null;
    }

    /** 만료 시 주차할 수 있는가(F16.7) — 질문형 도구 + 플래그 ON + 대기 연장을 영속할 저장소(없으면 재개할 근거가 없다). */
    private canPark(toolName: string): boolean {
        return HITL_ALWAYS_WAIT_TOOLS.has(toolName) && getConfig().agentTaskHitlParkOnTimeout && !!this.store?.extendPending;
    }

    /** 유예 후 주차 시각(ms) — 호출부가 재개 지점이 있다고 알린(parkable) 대기만. 0 이면 유예 없음(종전 만료 경로). */
    private parkGraceMs(parkable: boolean | undefined, timeoutMs: number): number {
        const grace = AGENT_TASK_LIMITS.HITL_PARK_GRACE_MS;
        return parkable && grace > 0 && this.store?.extendPending ? Math.min(grace, timeoutMs) : 0;
    }

    clearAutoApprove(taskId: string): void { this.autoApproveTasks.delete(taskId); }

    /**
     * 승인을 요청하고 결정(approved/rejected)을 await. timeout/abort 시 'rejected'.
     * onPending 콜백으로 호출부가 알림(web-push/WS)·상태('paused')를 발행한다.
     * 자동승인 task(HITL_ALWAYS_WAIT_TOOLS·바닥 호출 제외)는 대기 없이 즉시 approved.
     */
    async request(
        input: { taskId: string; userId: string; toolName: string; args: Record<string, unknown>; preview?: string },
        /** parkable — 부모 작업의 턴 실행 경로처럼 주차 후 같은 호출로 재개할 수 있는 대기(유예 후 주차 대상). */
        /** policy — 이 호출을 승인 대상으로 올린 정책. 요청 이벤트에 남겨 "왜 물었는지"를 나중에 되짚는다(정책은 env·작업별로 달라진다). */
        opts: { timeoutMs: number; signal?: AbortSignal; onPending?: (p: PendingApproval) => void; parkable?: boolean; policy?: TaskSandboxApprovalPolicy },
    ): Promise<ApprovalResult> {
        if (this.autoApproves(input.taskId, input.toolName, input.args)) {
            return { decision: 'approved', waitedMs: 0 };
        }
        // 무인 작업 — 기다려도 승인할 사람이 없다. 질문 도구는 종전대로 답을 기다린다(예약의 기본 동작을 바꾸지 않는다).
        if (this.unattendedTasks.has(input.taskId) && !HITL_ALWAYS_WAIT_TOOLS.has(input.toolName)) {
            const outcome = resolveUnattendedOutcome(UNATTENDED_APPROVAL_OUTCOME, approvalFloorReason(input.toolName, input.args) !== null);
            if (outcome !== 'wait') {
                logger.info(`[${input.taskId}] 무인 실행 — 승인 대기 없이 ${outcome === 'approve' ? '통과' : '거절'}: ${input.toolName}`);
                return outcome === 'approve' ? { decision: 'approved', waitedMs: 0 } : { decision: 'rejected', reason: 'unattended', waitedMs: 0 };
            }
        }
        // 재시작 후 이어받기(124): 같은 호출에 이미 내려진 결정이 있으면 대기 없이 소비하고,
        // 살아 있는 pending 이 있으면 그 id 를 그대로 써서 승인함의 항목이 바뀌지 않게 한다.
        const argsHash = hashApprovalArgs(input.args);
        // 저장소가 없으면(테스트·비영속) 대기 등록까지 동기적으로 끝낸다 — 호출 직후 list() 가 보이도록.
        let prior = this.store ? await this.persist((s) => s.takeoverForCall(input.taskId, input.toolName, argsHash)) : undefined;
        // 오래된 미소비 승인은 쓰지 않고 다시 묻는다 — 승인함 "최근 결정" 창을 벗어나면 사용자가 볼 수도 철회할 수도 없다.
        // 질문 도구의 답은 권한이 아니라 사용자의 답이라 그대로 이어받는다. 이어받기가 이미 소비 표시를 했으므로 행은 다시 쓰이지 않는다.
        if (prior?.status === 'approved' && !HITL_ALWAYS_WAIT_TOOLS.has(input.toolName)
            && prior.decided_at && Date.now() - new Date(prior.decided_at).getTime() > APPROVAL_RECENT_WINDOW_MS) {
            logger.info(`[${input.taskId}] 오래된 승인이라 다시 묻습니다: ${input.toolName}`);
            prior = undefined;
        }
        if (prior && prior.status !== 'pending') {
            logger.info(`[${input.taskId}] 재시작 전 결정 이어받음(${prior.status}): ${input.toolName}`);
            return prior.status === 'approved'
                ? { decision: 'approved', waitedMs: 0, ...(prior.answer_text ? { text: prior.answer_text } : {}) }
                : { decision: 'rejected', reason: 'user', waitedMs: 0, ...(prior.answer_text ? { text: prior.answer_text } : {}) };
        }
        const approvalId = prior?.approval_id ?? `apv_${input.taskId}_${Date.now().toString(36)}_${this.seq++}`;
        const riskClass = classifyToolRisk(input.toolName, input.args);
        // 저장·표시는 가린 사본으로 — 결속(argsHash)·위험 판정은 위에서 원래 인자로 끝냈다.
        const core = { taskId: input.taskId, userId: input.userId, toolName: input.toolName, args: redactApprovalArgs(input.toolName, input.args) };
        const preview = redactApprovalPreview(input.preview);
        const pending: PendingApproval = {
            approvalId, ...core, createdAt: prior ? new Date(prior.created_at).getTime() : Date.now(),
            riskClass, sensitive: isSensitiveWrite(input.toolName, input.args),
            ...(preview ? { preview } : prior?.preview ? { preview: prior.preview } : {}),
        };
        if (!prior && this.store) {
            await this.persist((s) => s.insertPending({ approvalId, ...core, argsHash, riskClass, timeoutMs: opts.timeoutMs, preview }));
            void this.event(approvalId, 'requested', null, { toolName: input.toolName, riskClass, ...(opts.policy ? { policy: opts.policy } : {}) });
        }
        return new Promise<ApprovalResult>((resolvePromise) => {
            const settle = (r: Omit<ApprovalResult, 'waitedMs'>) => {
                const w = this.waiters.get(approvalId);
                if (!w) return;
                clearTimeout(w.timer);
                this.waiters.delete(approvalId);
                if (r.decision === 'rejected') logger.info(`[${input.taskId}] 승인 거절/만료(${r.reason}): ${input.toolName}`);
                // 주차(F16.7) — 결정이 아니라 대기 연장: 행은 pending 으로 남아 승인함에 계속 보이고, 답은 재개된 작업이 소비한다
                if (r.reason === 'parked') void this.persist((s) => s.extendPending!(approvalId, AGENT_TASK_LIMITS.HITL_PARK_MAX_MS));
                // 살아 있는 waiter 의 결정은 즉시 실행(소비)된다 — consumed 표시로 재시작 이어받기·철회(138) 대상에서 뺀다
                else void this.persist((s) => s.markDecided(approvalId,
                    r.decision === 'approved' ? 'approved' : r.reason === 'timeout' ? 'expired' : r.reason === 'abort' ? 'aborted' : 'rejected',
                    r.text, undefined, true));
                resolvePromise({ ...r, waitedMs: Date.now() - pending.createdAt });
            };
            const graceMs = this.parkGraceMs(opts.parkable, opts.timeoutMs);
            const timer = graceMs > 0
                ? setTimeout(() => settle({ decision: 'rejected', reason: 'parked' }), graceMs)
                : setTimeout(() => settle({ decision: 'rejected', reason: this.canPark(input.toolName) ? 'parked' : 'timeout' }), opts.timeoutMs);
            this.waiters.set(approvalId, { pending, resolve: (r) => settle(r), timer, floor: approvalFloorReason(input.toolName, input.args) !== null });
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
    approve(approvalId: string, actorId?: string): Promise<boolean> {
        void this.event(approvalId, 'approved', actorId);
        return this.settleOrPersist(approvalId, { decision: 'approved' });
    }

    /**
     * 철회(138) — "아직 실행되지 않은 허가" 만 되돌린다: 살아 있는 waiter 는 결정 즉시 도구가 실행되므로
     * 'consumed', 저장소의 미소비 approved 행(프로세스가 내려간 사이 내린 승인)만 'revoked'.
     */
    async revoke(approvalId: string, actorId: string): Promise<'revoked' | 'consumed' | 'not_found'> {
        if (this.waiters.has(approvalId)) return 'consumed';
        if (!this.store?.revokeUnconsumed) return 'not_found';
        const r = (await this.persist((s) => s.revokeUnconsumed!(approvalId, actorId))) ?? 'not_found';
        if (r === 'revoked') void this.event(approvalId, 'revoked', actorId);
        return r;
    }

    /**
     * 담당자 이관·에스컬레이션(138) — 살아 있는 waiter 의 pending 과 저장소 행을 함께 갱신. 권한(같은 조직·admin)은 호출부.
     * 결정 채널(approve/reject/answer)은 그대로이므로 새 담당자가 결정하면 종전과 같이 해소된다.
     */
    async reassign(approvalId: string, toUserId: string, actorId: string, opts: { escalate?: boolean; reason?: string | null } = {}): Promise<boolean> {
        const w = this.waiters.get(approvalId);
        if (w) w.pending.assigneeUserId = toUserId;
        const ok = this.store?.reassign ? (await this.persist((s) => s.reassign!(approvalId, toUserId, opts))) === true : false;
        if (!w && !ok) return false;
        void this.event(approvalId, opts.escalate ? 'escalated' : 'reassigned', actorId, { toUserId, reason: opts.reason ?? null });
        return true;
    }

    /** 최근 결정 목록(138) — 저장소가 없으면 빈 목록. */
    async recent(userId: string, sinceMs: number): Promise<Array<ApprovalRow & { revocable: boolean }>> {
        if (!this.store?.listRecentDecisions) return [];
        return (await this.persist((s) => s.listRecentDecisions!(userId, sinceMs))) ?? [];
    }

    private event(approvalId: string, kind: 'approved' | 'rejected' | 'answered' | 'revoked' | 'requested' | 'reassigned' | 'escalated', actorId?: string | null, detail?: Record<string, unknown>): Promise<void> {
        if (!this.store?.recordEvent) return Promise.resolve();
        return this.persist((s) => s.recordEvent!(approvalId, kind, actorId ?? null, detail)).then(() => undefined);
    }

    /** REST 거절 — reasonText 는 사용자가 적은 사유(선택). 답변과 같은 칸(answer_text)에 남아 재시작 뒤에도 모델에 전달된다. */
    reject(approvalId: string, actorId?: string, reasonText?: string): Promise<boolean> {
        void this.event(approvalId, 'rejected', actorId);
        return this.settleOrPersist(approvalId, { decision: 'rejected', reason: 'user', ...(reasonText ? { text: reasonText } : {}) });
    }

    /**
     * REST 자유텍스트 답변 — ask_human 질문에 사용자가 텍스트로 응답. 진행(approved)으로
     * 해소하되 답변 본문을 함께 전달해 에이전트가 실제 답을 받아 이어가게 한다.
     * (승인 게이트가 아닌 ask_human 대기에만 의미 있음 — 호출부가 owner 검증.)
     */
    answer(approvalId: string, text: string, actorId?: string): Promise<boolean> {
        void this.event(approvalId, 'answered', actorId, { chars: text.length });
        return this.settleOrPersist(approvalId, { decision: 'approved', text });
    }

    /** 작업 종료 시 저장소에 남은 pending 정리(124) — 메모리 waiter 는 signal abort 가 이미 해소했다. */
    closeTask(taskId: string): void {
        this.autoApproveTasks.delete(taskId);
        this.unattendedTasks.delete(taskId);
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
            markDecided: (id, s, t, by, c) => lazy().markDecided(id, s, t, by, c),
            listPending: (u) => lazy().listPending(u),
            getPending: (id) => lazy().getPending(id),
            takeoverForCall: (t, n, h) => lazy().takeoverForCall(t, n, h),
            expirePendingForTask: (t, s) => lazy().expirePendingForTask(t, s),
            revokeUnconsumed: (id, a) => lazy().revokeUnconsumed(id, a),
            listRecentDecisions: (u, ms, l) => lazy().listRecentDecisions(u, ms, l),
            recordEvent: (id, k, a, d) => lazy().recordEvent(id, k, a, d),
            reassign: (id, to, o) => lazy().reassign(id, to, o),
            extendPending: (id, ms) => lazy().extendPending(id, ms),
        });
    }
    return registry;
}
