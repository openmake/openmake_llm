/**
 * @module services/orchestrator/executor
 * @description 계획 실행 — depends_on 레벨 순서로, 레벨 안은 병렬(Promise.allSettled).
 *  - 실패한 부모의 자식은 `skipped`(실행·과금 없음), 독립 작업은 계속. DAG 재실행 없음.
 *  - 상한: 레벨 병렬(ORCHESTRATOR.MAX_PARALLEL) · 프로세스 전체 동시 실행(GLOBAL_MAX_INFLIGHT) ·
 *    작업당 TASK_TIMEOUT_MS · 턴 전체 TURN_DEADLINE_MS · 사용자 취소(ctx.signal) 전파.
 *  - provider 별 세마포어·429 백오프는 http-call → external-throttle 이 담당.
 */
import { ORCHESTRATOR } from '../../config/capabilities';
import { CapabilityUnavailableError } from './capability-resolver';
import { executorFor, UnsupportedCapabilityError } from './executors';
import { combineSignals, HttpCallError } from './http-call';
import type { PlanTask, ValidatedPlan } from './plan-schema';
import type { ExecContext, TaskResult } from './types';
import { createLogger } from '../../utils/logger';

const logger = createLogger('OrchestratorExecutor');

export interface ExecutionSummary {
    results: TaskResult[];
    ok: number;
    /** 제출됐지만 미완료(영상 등) — 성공도 실패도 아님 */
    pending: number;
    failed: number;
    skipped: number;
    ms: number;
    cancelled: boolean;
}

/** 프로세스 전체 동시 실행 상한 — 단순 카운팅 세마포어 */
class Gate {
    private inflight = 0;
    private waiters: Array<{ resolve: () => void; reject: (e: Error) => void; onAbort?: () => void; signal?: AbortSignal }> = [];
    constructor(private readonly limit: number) {}
    /** 대기열에서도 취소된다(항목 제거 + reject), 깨어난 뒤 aborted 재검사 */
    async acquire(signal?: AbortSignal): Promise<() => void> {
        for (;;) {
            if (signal?.aborted) throw new Error('취소됨');
            if (this.inflight < this.limit) break;
            await new Promise<void>((resolve, reject) => {
                const entry: { resolve: () => void; reject: (e: Error) => void; onAbort?: () => void; signal?: AbortSignal } = { resolve, reject, signal };
                if (signal) {
                    entry.onAbort = () => { const k = this.waiters.indexOf(entry); if (k >= 0) this.waiters.splice(k, 1); reject(new Error('취소됨')); };
                    signal.addEventListener('abort', entry.onAbort, { once: true });
                }
                this.waiters.push(entry);
            });
        }
        this.inflight++;
        return () => {
            this.inflight--;
            const next = this.waiters.shift();
            if (next) { if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort); next.resolve(); }
        };
    }
}
const globalGate = new Gate(Math.max(1, ORCHESTRATOR.GLOBAL_MAX_INFLIGHT));

function classify(err: unknown): { error: string; kind: 'unsupported' | 'unassigned' | 'cancelled' | 'failed' } {
    if (err instanceof UnsupportedCapabilityError) return { error: err.message, kind: 'unsupported' };
    if (err instanceof CapabilityUnavailableError) return { error: err.message, kind: err.code === 'CAPABILITY_UNASSIGNED' ? 'unassigned' : 'failed' };
    if (err instanceof HttpCallError && err.kind === 'aborted') return { error: '취소됨', kind: 'cancelled' };
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg, kind: /취소됨|aborted/i.test(msg) ? 'cancelled' : 'failed' };
}

async function runTask(task: PlanTask, ctx: ExecContext, turnSignal: AbortSignal): Promise<TaskResult> {
    const startedAt = Date.now();
    ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'running' });
    const signal = combineSignals(turnSignal, AbortSignal.timeout(ORCHESTRATOR.TASK_TIMEOUT_MS));
    const taskCtx: ExecContext = { ...ctx, signal };
    let release: (() => void) | undefined;
    try {
        release = await globalGate.acquire(signal);
        const out = await executorFor(task.capability)(task, taskCtx);
        const status = out.status ?? (out.ok ? 'completed' : 'failed');
        const { job: _job, ...rest } = out;
        // pending(제출됐지만 미완료)은 ok=false — 자식 실행 금지·성공 집계 제외. 실패로도 단정하지 않는다.
        const result: TaskResult = { taskId: task.id, capability: task.capability, ms: Date.now() - startedAt, ...rest, ok: status === 'completed', status };
        ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: status === 'completed' ? 'ok' : status === 'pending' ? 'pending' : 'failed', summary: result.text.slice(0, 120), ms: result.ms });
        return result;
    } catch (err) {
        const c = classify(err);
        const result: TaskResult = { taskId: task.id, capability: task.capability, ok: false, status: 'failed', text: `[${c.kind}] ${c.error}`, media: [], ms: Date.now() - startedAt, error: c.error };
        logger.warn(`[Executor] ${task.id} ${task.capability} ${c.kind}: ${c.error.slice(0, 200)}`);
        ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: c.error.slice(0, 120), ms: result.ms });
        return result;
    } finally {
        release?.();
    }
}

export async function executePlan(plan: ValidatedPlan, ctx: ExecContext): Promise<ExecutionSummary> {
    const startedAt = Date.now();
    const turnSignal = combineSignals(ctx.signal, AbortSignal.timeout(ORCHESTRATOR.TURN_DEADLINE_MS));
    const results: TaskResult[] = [];
    const failedOrSkipped = new Set<string>();
    let cancelled = false;

    for (const level of plan.levels) {
        if (turnSignal.aborted) { cancelled = !!ctx.signal?.aborted; break; }
        const runnable: PlanTask[] = [];
        for (const task of level) {
            // preflight 가 실행 전에 거절한 작업(미배정·키·미지원·입력·쿼터) — 호출·과금 없이 실패로 확정
            const pre = ctx.results.get(task.id);
            if (pre) { results.push(pre); failedOrSkipped.add(task.id); ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: pre.text.slice(0, 120) }); continue; }
            const blockedBy = task.dependsOn.find((d) => failedOrSkipped.has(d));
            if (blockedBy) {
                const r: TaskResult = { taskId: task.id, capability: task.capability, ok: false, status: 'skipped', text: `[skipped] 선행 작업 '${blockedBy}' 미완료(${ctx.results.get(blockedBy)?.status ?? 'failed'})`, media: [], ms: 0, error: `skipped: ${blockedBy}` };
                results.push(r); ctx.results.set(task.id, r); failedOrSkipped.add(task.id);
                ctx.onProgress?.({ type: 'orchestrator_task', id: task.id, capability: task.capability, status: 'failed', summary: r.text });
                continue;
            }
            runnable.push(task);
        }
        // 레벨 안 병렬 — MAX_PARALLEL 은 검증 단계에서 이미 보장, allSettled 로 부분 실패 흡수
        const settled = await Promise.allSettled(runnable.map((t) => runTask(t, ctx, turnSignal)));
        settled.forEach((s, i) => {
            const task = runnable[i];
            const r: TaskResult = s.status === 'fulfilled'
                ? s.value
                : { taskId: task.id, capability: task.capability, ok: false, status: 'failed', text: `[failed] ${String(s.reason)}`, media: [], ms: 0, error: String(s.reason) };
            results.push(r); ctx.results.set(task.id, r);
            if (!r.ok) failedOrSkipped.add(task.id);
        });
        // 마지막 레벨 실행 도중 취소돼도 cancelled 로 집계
        if (ctx.signal?.aborted) { cancelled = true; break; }
    }
    // 실행하지 못한 나머지 레벨(취소·deadline)은 skipped 로 채운다
    const done = new Set(results.map((r) => r.taskId));
    for (const task of plan.tasks) {
        if (done.has(task.id)) continue;
        const r: TaskResult = { taskId: task.id, capability: task.capability, ok: false, status: 'skipped', text: cancelled ? '[cancelled]' : '[skipped] 턴 시간 초과', media: [], ms: 0, error: cancelled ? 'cancelled' : 'turn deadline' };
        results.push(r); ctx.results.set(task.id, r);
    }
    const ok = results.filter((r) => r.status === 'completed').length;
    const pending = results.filter((r) => r.status === 'pending').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    return { results, ok, pending, failed: results.length - ok - pending - skipped, skipped, ms: Date.now() - startedAt, cancelled: cancelled || !!ctx.signal?.aborted };
}
