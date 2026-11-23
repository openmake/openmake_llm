/**
 * @module services/orchestrator/executor
 * @description 계획 실행 — 스케줄링은 범용 DAG 실행기(workflow/dag-runner): 기본은 depends_on 레벨 순서·레벨 안 병렬,
 *  ORCHESTRATOR_DAG_EAGER=true 면 레벨 장벽 없이 선행이 끝난 작업부터.
 *  - 실패한 부모의 자식은 `skipped`(실행·과금 없음), 독립 작업은 계속. DAG 재실행 없음.
 *  - 상한: 레벨 병렬(ORCHESTRATOR.MAX_PARALLEL) · 프로세스 전체 동시 실행(GLOBAL_MAX_INFLIGHT) ·
 *    작업당 TASK_TIMEOUT_MS · 턴 전체 TURN_DEADLINE_MS · 사용자 취소(ctx.signal) 전파.
 *  - provider 별 세마포어·429 백오프는 http-call → external-throttle 이 담당.
 */
import { ORCHESTRATOR, ORCHESTRATOR_CONNECT_FAILURE_CODES } from '../../config/capabilities';
import { CapabilityUnavailableError } from './capability-resolver';
import { executorFor, UnsupportedCapabilityError } from './executors';
import { combineSignals, HttpCallError, QueueTimeoutError, queueTimeoutError } from './http-call';
import { CapabilityNotRegisteredError } from '../../capability-contract/errors';
import { recheckHandle, ADMISSION_LABEL, CapabilityAdmissionError, type ApprovedInvocationHandle } from '../../capability-contract/admission';
import { BASE_CAPABILITY_OWNER, type CapabilityContext } from '../../capability-contract/types';
import { getCapabilityRegistry } from '../../runtime-ports/capability-runtime';
import { createRestrictedInvoker, type RestrictedModelInvoker } from '../../runtime-ports/model-invoker';
import { scopedArtifactStore } from '../../runtime-ports/artifact-store';
import { scopedJobRuntime } from '../../runtime-ports/job-runtime';
import * as crypto from 'node:crypto';
import type { PlanTask, ValidatedPlan } from './plan-schema';
import type { ExecContext, TaskResult } from './types';
import { createLogger } from '../../utils/logger';
import { runDag } from '../../workflow/dag-runner';

const logger = createLogger('OrchestratorExecutor');

interface ExecutionSummary {
    results: TaskResult[];
    ok: number;
    /** 제출됐지만 미완료(영상 등) — 성공도 실패도 아님 */
    pending: number;
    failed: number;
    skipped: number;
    ms: number;
    cancelled: boolean;
}

/**
 * 대기 중단 오류 — 작업·턴 타임아웃이면 signal 의 TimeoutError(classify 가 [timeout] 으로), 사용자 취소면 '취소됨'.
 * 실제로 기다리다 걸렸으면(waited) QueueTimeoutError — 사유 `timeout_queued`. 들어오자마자 중단돼 있던 경우는 아니다.
 */
function abortError(signal: AbortSignal, waited = false): Error {
    if ((signal.reason as { name?: unknown } | undefined)?.name !== 'TimeoutError') return new Error('취소됨');
    return waited ? queueTimeoutError(signal) : signal.reason as Error;
}

/** 프로세스 전체 동시 실행 상한 — 단순 카운팅 세마포어 */
class Gate {
    private inflight = 0;
    private waiters: Array<{ resolve: () => void; reject: (e: Error) => void; onAbort?: () => void; signal?: AbortSignal }> = [];
    constructor(private readonly limit: number) {}
    /**
     * 대기열에서도 취소된다(항목 제거 + reject). 깨어나면 이벤트 루프를 한 번 양보한 뒤 aborted 재검사 —
     * 같은 시각에 만료되는 대기자가 앞 작업이 놓은 자리로 handler 를 시작했다 곧바로 끊기지 않게.
     * 만료 시각이 ms 단위로 어긋나면 handler 를 시작한 뒤 끊길 수 있다(그때 사유는 `timeout`).
     * 깨어난 대기자가 중단으로 빠지면 받은 차례를 다음 대기자에게 넘긴다(뒤 대기자가 자기 시간 제한까지 묶이지 않게).
     */
    async acquire(signal?: AbortSignal): Promise<() => void> {
        let woke = false;
        for (;;) {
            if (signal?.aborted) {
                if (woke) this.wakeNext();
                throw abortError(signal, woke);
            }
            if (this.inflight < this.limit) break;
            await new Promise<void>((resolve, reject) => {
                const entry: { resolve: () => void; reject: (e: Error) => void; onAbort?: () => void; signal?: AbortSignal } = { resolve, reject, signal };
                if (signal) {
                    entry.onAbort = () => { const k = this.waiters.indexOf(entry); if (k >= 0) this.waiters.splice(k, 1); reject(abortError(signal, true)); };
                    signal.addEventListener('abort', entry.onAbort, { once: true });
                }
                this.waiters.push(entry);
            });
            await new Promise<void>((r) => setImmediate(r));
            woke = true;
        }
        this.inflight++;
        return () => {
            this.inflight--;
            this.wakeNext();
        };
    }
    private wakeNext(): void {
        const next = this.waiters.shift();
        if (next) { if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort); next.resolve(); }
    }
}
const globalGate = new Gate(Math.max(1, ORCHESTRATOR.GLOBAL_MAX_INFLIGHT));

/** fetch 연결 단계 실패 — cause.code(한 단계) 또는 자체 code 가 연결 실패 코드 집합에 있을 때. 문구로 판정하지 않는다 */
function isConnectFailure(err: unknown): boolean {
    const e = err as { code?: unknown; cause?: unknown } | null;
    const code = (e?.cause as { code?: unknown } | null | undefined)?.code ?? e?.code;
    return typeof code === 'string' && ORCHESTRATOR_CONNECT_FAILURE_CODES.has(code);
}

/**
 * kind 는 결과 text 의 `[kind]`(종합 모델 입력·저장 규약 — 그대로), reason 은 실패 이벤트에만 싣는 세분 사유(없으면 kind).
 * reason: timeout_queued(실행 차례 대기 중 시간 초과)·upstream(서비스가 5xx)·unreachable(연결 자체 실패).
 */
function classify(err: unknown): { error: string; kind: string; reason?: string } {
    if (err instanceof UnsupportedCapabilityError) return { error: err.message, kind: 'unsupported' };
    if (err instanceof CapabilityNotRegisteredError) return { error: err.message, kind: 'disabled' };
    if (err instanceof CapabilityAdmissionError) return { error: err.message, kind: err.label };
    if (err instanceof CapabilityUnavailableError) return { error: err.message, kind: err.code === 'CAPABILITY_UNASSIGNED' ? 'unassigned' : 'failed' };
    if (err instanceof HttpCallError && err.kind === 'aborted') return { error: '취소됨', kind: 'cancelled' };
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof QueueTimeoutError) return { error: msg, kind: 'timeout', reason: 'timeout_queued' };
    // AbortSignal.timeout(작업·호출 타임아웃)은 사용자 취소가 아니다 — 메시지에 'aborted' 가 있어 아래 패턴에 걸리므로 먼저 구분한다
    if ((err as { name?: unknown } | null)?.name === 'TimeoutError') return { error: msg, kind: 'timeout' };
    // 5xx 본문은 공급자·게이트웨이 원문 — 4xx·키 거절은 서버가 만든 구체 사유라 failed 그대로
    if (err instanceof HttpCallError && err.kind === 'http' && (err.status ?? 0) >= 500 && !err.keyRejected) return { error: msg, kind: 'failed', reason: 'upstream' };
    if (isConnectFailure(err)) return { error: msg, kind: 'failed', reason: 'unreachable' };
    return { error: msg, kind: /취소됨|aborted/i.test(msg) ? 'cancelled' : 'failed' };
}

/** 실행 대상이 없는 작업(web.search·저장본 재조회)의 포트 — 호출하면 명시 실패 */
function noTargetInvoker(capability: string): RestrictedModelInvoker {
    const deny = () => { throw new Error(`${capability}: 이 작업에는 승인된 모델 호출 대상이 없습니다`); };
    return { describe: deny, invokeJson: async () => deny(), invokeBinary: async () => deny(), download: async () => deny() };
}

/**
 * handler 에 넘길 문맥(P04) — `targets`(헤더·키)·`handles` 를 뺀 CapabilityContext. Base 소유(legacy bridge) 실행기만 전환 기간 동안
 * `targets` 를 덧붙여 받는다. add-on 은 `model` 포트로만 호출한다(T08).
 */
function buildHandlerContext(task: PlanTask, ctx: ExecContext, handle: ApprovedInvocationHandle, ownerAddonId: string): CapabilityContext {
    const { targets, handles: _handles, ...rest } = ctx;
    const target = targets?.get(task.id);
    const base: CapabilityContext = {
        ...rest,
        invocation: handle,
        model: target ? createRestrictedInvoker(handle, target, getCapabilityRegistry().get(task.capability)?.handler.operations) : noTargetInvoker(task.capability),
        artifacts: scopedArtifactStore({ userId: ctx.userId, sessionId: ctx.sessionId, capability: task.capability }),
        jobs: scopedJobRuntime(handle),
        traceId: crypto.randomUUID(),
    };
    return ownerAddonId === BASE_CAPABILITY_OWNER.addonId ? Object.assign(base, { targets }) : base;
}

/** 진행 이벤트의 model 필드 — 승인된 실행 대상의 표기(채팅 served_model 과 같은 규칙: 로컬 bare id, 외부 fullId). 대상이 없으면 생략 */
function taskModelField(task: PlanTask, ctx: ExecContext): { model?: string } {
    const target = ctx.targets?.get(task.id);
    if (!target) return {};
    return { model: target.providerId === 'local-llm' ? target.model : target.fullId };
}

/** 실패 이벤트의 reason·provider — provider 는 실행 대상이 외부일 때만(웹이 model 문자열로 외부 여부를 추측하지 않게) */
function failureFields(task: PlanTask, ctx: ExecContext, reason: string): { reason: string; provider?: string } {
    const target = ctx.targets?.get(task.id);
    return target && target.providerId !== 'local-llm' ? { reason, provider: target.providerId } : { reason };
}

/** `[kind] 사유` 규약 text 의 맨 앞 kind — 형식이 아니면 'failed' */
function textKind(text: string): string {
    return /^\[([^\]\s]+)\]/.exec(text)?.[1] ?? 'failed';
}

/**
 * 실행을 시도했다가 실패한 작업의 TaskResult — 실패 경로가 어디든(handler throw·타임아웃·runTask reject) 여기서 만든다.
 * model 은 preflight 가 승인한 실행 대상의 fullId(성공 결과·task_results 와 같은 표기). 대상이 없는 작업(web.search·저장본 재조회)은 생략.
 * 호출 자체를 하지 않은 작업(preflight 거절·선행 미완료 skipped·턴 시간 초과)은 여기를 거치지 않으므로 model 이 비어 있다.
 */
function failedRunResult(task: PlanTask, ctx: ExecContext, text: string, error: string, ms: number): TaskResult {
    const target = ctx.targets?.get(task.id);
    return { taskId: task.id, capability: task.capability, ok: false, status: 'failed', text, media: [], ms, error, ...(target ? { model: target.fullId } : {}) };
}

async function runTask(task: PlanTask, ctx: ExecContext, turnSignal: AbortSignal): Promise<TaskResult> {
    const startedAt = Date.now();
    const modelField = taskModelField(task, ctx);
    ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'running', ...modelField });
    const signal = combineSignals(turnSignal, AbortSignal.timeout(ORCHESTRATOR.TASK_TIMEOUT_MS));
    const taskCtx: ExecContext = { ...ctx, signal };
    let release: (() => void) | undefined;
    try {
        release = await globalGate.acquire(signal);
        // 승인 handle 재검사(P03) — 계획·승인 뒤 관리자가 소유 add-on 을 껐거나 상태를 알 수 없으면 유료 요청 전송 전에 거절(T03)
        let handle = ctx.handles?.get(task.id);
        if (ctx.handles) {
            if (!handle) throw new CapabilityAdmissionError('unapproved', `${task.capability}: 실행 승인(handle)이 없습니다`);
            const re = await recheckHandle(handle);
            if (!re.ok) throw new CapabilityAdmissionError(re.code === 'HANDLE_EXPIRED' ? 'expired' : ADMISSION_LABEL[re.code], re.reason);
        }
        const owner = getCapabilityRegistry().get(task.capability)?.owner ?? BASE_CAPABILITY_OWNER;
        // preflight 없이 온 호출(테스트·레거시)은 Base 소유로 간주한 handle 을 만든다 — 승인 경계는 ctx.handles 가 있을 때만 강제한다
        handle ??= { taskId: task.id, capability: task.capability, userId: ctx.userId, sessionId: ctx.sessionId, owner, registryRevision: 0, stateRevision: 0, issuedAt: startedAt, deadline: startedAt + ORCHESTRATOR.TURN_DEADLINE_MS };
        const handlerCtx = buildHandlerContext(task, taskCtx, handle, owner.addonId);
        const out = await executorFor(task.capability)(task, handlerCtx as unknown as ExecContext);
        const status = out.status ?? (out.ok ? 'completed' : 'failed');
        const { job: _job, ...rest } = out;
        // pending(제출됐지만 미완료)은 ok=false — 자식 실행 금지·성공 집계 제외. 실패로도 단정하지 않는다.
        const result: TaskResult = { taskId: task.id, capability: task.capability, ms: Date.now() - startedAt, ...rest, ok: status === 'completed', status };
        ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: status === 'completed' ? 'ok' : status === 'pending' ? 'pending' : 'failed', summary: result.text.slice(0, 120), ms: result.ms, ...modelField, ...(status === 'failed' ? failureFields(task, ctx, 'failed') : {}) });
        return result;
    } catch (err) {
        const c = classify(err);
        // 작업·턴 시간 제한으로 끊긴 대기가 Error('취소됨') 을 던진 경우 — 사용자 취소가 아니다(abortError 와 같은 규칙). 문구도 시간 초과 원문으로
        const reason = signal.reason as { name?: unknown; message?: unknown } | undefined;
        if (c.kind === 'cancelled' && reason?.name === 'TimeoutError') { c.kind = 'timeout'; c.error = String(reason.message ?? c.error); }
        const result = failedRunResult(task, ctx, `[${c.kind}] ${c.error}`, c.error, Date.now() - startedAt);
        logger.warn(`[Executor] ${task.id} ${task.capability} ${c.kind}: ${c.error.slice(0, 200)}`);
        ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: c.error.slice(0, 120), ms: result.ms, ...modelField, ...failureFields(task, ctx, c.reason ?? c.kind) });
        return result;
    } finally {
        release?.();
    }
}

export async function executePlan(plan: ValidatedPlan, ctx: ExecContext): Promise<ExecutionSummary> {
    const startedAt = Date.now();
    const turnSignal = combineSignals(ctx.signal, AbortSignal.timeout(ORCHESTRATOR.TURN_DEADLINE_MS));
    const wasCancelled = () => !!ctx.signal?.aborted;
    // 스케줄링은 범용 DAG 실행기(workflow/dag-runner)가 맡고, 여기서는 결과·진행 이벤트만 만든다.
    // 레벨 장벽(종전)이 기본, ORCHESTRATOR_DAG_EAGER=true 면 선행이 끝난 작업을 바로 시작한다.
    const { settled } = await runDag<PlanTask, TaskResult>({
        nodes: plan.tasks,
        levels: plan.levels,
        mode: ORCHESTRATOR.DAG_EAGER ? 'eager' : 'levels',
        maxParallel: ORCHESTRATOR.MAX_PARALLEL, // 레벨 폭은 검증 단계에서 이미 보장 — eager 에선 이 값이 동시 실행 상한
        signal: turnSignal,
        run: (task) => runTask(task, ctx, turnSignal),
        isOk: (r) => r.ok,
        // preflight 가 실행 전에 거절한 작업(미배정·키·미지원·입력·쿼터) — 호출·과금 없이 실패로 확정
        presettled: (task) => ctx.results.get(task.id),
        onBlocked: (task, blockedBy) => ({ taskId: task.id, capability: task.capability, ok: false, status: 'skipped', text: `[skipped] 선행 작업 미완료(${ctx.results.get(blockedBy)?.status ?? 'failed'})`, media: [], ms: 0, error: `skipped: ${blockedBy}` }),
        onRejected: (task, reason) => failedRunResult(task, ctx, `[failed] ${String(reason)}`, String(reason), 0),
        // 실행하지 못한 나머지(취소·deadline)
        onUnreached: (task) => {
            const cancelled = wasCancelled();
            return { taskId: task.id, capability: task.capability, ok: false, status: 'skipped', text: cancelled ? '[cancelled]' : '[skipped] 턴 시간 초과', media: [], ms: 0, error: cancelled ? 'cancelled' : 'turn deadline' };
        },
        onSettled: (task, r, how) => {
            if (how === 'presettled') { ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: r.text.slice(0, 120), ...failureFields(task, ctx, textKind(r.text)) }); return; }
            ctx.results.set(task.id, r);
            if (how === 'blocked') ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: r.text, ...failureFields(task, ctx, 'skipped') });
            // 턴 시간 초과면 배너가 남으므로 실패로 알린다(취소면 배너가 사라져 알리지 않는다)
            if (how === 'unreached' && !wasCancelled()) ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: r.text, ...failureFields(task, ctx, 'deadline') });
        },
    });
    const results = settled.map((x) => x.result);
    const ok = results.filter((r) => r.status === 'completed').length;
    const pending = results.filter((r) => r.status === 'pending').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    return { results, ok, pending, failed: results.length - ok - pending - skipped, skipped, ms: Date.now() - startedAt, cancelled: wasCancelled() };
}
