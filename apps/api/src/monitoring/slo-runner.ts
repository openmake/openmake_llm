/**
 * SLO 평가 실행 (F24.8, 145) — SLI 집계 → 평가(PURE) → 스냅샷 적재 → burn-rate 알림.
 * 5분 tick(schedulers/index.ts)과 관리자 조회(GET /api/metrics/slo)가 같은 계산을 쓴다. 전부 fail-open.
 *
 * @module monitoring/slo-runner
 */
import type { Pool } from 'pg';
import { SLO_BURN_RULES, SLO_DEFS, SLO_LIMITS, resolveSloTargets, type SloId } from '../config/slo';
import { SloRepository } from '../data/repositories/slo-repository';
import { createLogger } from '../utils/logger';
import {
    decideSloAlert, evaluatePointSlo, evaluateRatioSlo,
    type RatioCounts, type SloAlertMemory, type SloEvaluation,
} from './slo-evaluator';

const logger = createLogger('SLO');
const EMPTY: RatioCounts = { total: 0, bad: 0 };
const alertMemory = new Map<SloId, SloAlertMemory>();

type SendAlert = (type: 'slo_burn_rate', severity: 'warning' | 'critical', title: string, message: string, data?: Record<string, unknown>) => Promise<void>;

/** PURE: 한 SLO 가 필요로 하는 창 목록(전체·fast 긴/짧은·slow 긴/짧은). */
export function sloWindows(windowHours: number): number[] {
    const { fast, slow } = SLO_BURN_RULES;
    return [windowHours, fast.longHours, fast.shortHours, slow.longHours, slow.shortHours];
}

function pick(m: Map<number, RatioCounts>, windowHours: number) {
    const get = (h: number) => m.get(h) ?? EMPTY;
    const { fast, slow } = SLO_BURN_RULES;
    return { window: get(windowHours), fastLong: get(fast.longHours), fastShort: get(fast.shortHours), slowLong: get(slow.longHours), slowShort: get(slow.shortHours) };
}

/** 4종 SLO 평가 — 소스 하나가 실패해도(테이블 미적용 등) 나머지는 계산한다. */
export async function computeSloEvaluations(pool: Pool): Promise<SloEvaluation[]> {
    const repo = new SloRepository(pool);
    const { targets, ttftThresholdMs } = resolveSloTargets();
    const out: SloEvaluation[] = [];
    const safe = async (id: SloId, fn: () => Promise<SloEvaluation>) => {
        try { out.push(await fn()); } catch (e) {
            logger.debug(`SLO ${id} 계산 실패: ${e instanceof Error ? e.message : e}`);
            out.push({ sloId: id, windowHours: SLO_DEFS[id].windowHours, target: targets[id], sliValue: null, sampleCount: 0, budgetRemaining: null, burnRateFast: null, burnRateSlow: null, state: 'insufficient', reason: 'source_unavailable' });
        }
    };

    const avail = SLO_DEFS.chat_availability;
    await safe('chat_availability', async () => evaluateRatioSlo({
        sloId: avail.id, windowHours: avail.windowHours, target: targets.chat_availability,
        counts: pick(await repo.chatAvailabilityCounts(sloWindows(avail.windowHours)), avail.windowHours),
    }));

    const ttft = SLO_DEFS.chat_ttft_p95;
    await safe('chat_ttft_p95', async () => {
        const [counts, p95] = await Promise.all([
            repo.chatTtftCounts(sloWindows(ttft.windowHours), ttftThresholdMs), repo.chatTtftP95(ttft.windowHours),
        ]);
        return evaluateRatioSlo({
            sloId: ttft.id, windowHours: ttft.windowHours, target: targets.chat_ttft_p95,
            counts: pick(counts, ttft.windowHours), detail: { thresholdMs: ttftThresholdMs, p95Ms: p95 === null ? null : Math.round(p95) },
        });
    });

    const task = SLO_DEFS.agent_task_success;
    await safe('agent_task_success', async () => evaluateRatioSlo({
        sloId: task.id, windowHours: task.windowHours, target: targets.agent_task_success,
        counts: pick(await repo.agentTaskCounts(sloWindows(task.windowHours)), task.windowHours),
    }));

    const ev = SLO_DEFS.eval_pass;
    await safe('eval_pass', async () => {
        const latest = await repo.latestEvalPass(SLO_LIMITS.EVAL_RUNNER, ev.windowHours);
        return evaluatePointSlo({
            sloId: ev.id, windowHours: ev.windowHours, target: targets.eval_pass,
            value: latest?.passRate ?? null, sampleCount: latest?.totalCases ?? 0,
            ...(latest ? { detail: { runner: SLO_LIMITS.EVAL_RUNNER, completedAt: latest.completedAt } } : {}),
        });
    });

    return out;
}

function pct(n: number | null): string {
    return n === null ? '—' : `${(n * 100).toFixed(2)}%`;
}

function describe(e: SloEvaluation): string {
    return `${e.sloId}: SLI ${pct(e.sliValue)} (목표 ${pct(e.target)}) · 버짓 잔량 ${pct(e.budgetRemaining)} · burn fast ${e.burnRateFast ?? '—'}× / slow ${e.burnRateSlow ?? '—'}× · 사유 ${e.reason ?? '-'}`;
}

/**
 * tick — 평가·적재·알림. 알림은 SLO 별 상태 악화 또는 REALERT_MS 경과 시에만(5분마다 반복 발송 방지)이고,
 * 심각도별로 한 건에 묶는다 — AlertSystem 쿨다운 키가 `type:severity` 라 SLO 마다 따로 보내면 두 번째부터 삼켜진다.
 */
export async function runSloTick(pool: Pool, sendAlert: SendAlert, now = Date.now()): Promise<SloEvaluation[]> {
    const evals = await computeSloEvaluations(pool);
    await new SloRepository(pool).insertSnapshots(evals).catch((e) => logger.debug(`slo_snapshots 적재 실패(145 미적용?): ${e instanceof Error ? e.message : e}`));
    const due: Record<'warning' | 'critical', SloEvaluation[]> = { warning: [], critical: [] };
    for (const e of evals) {
        const { send, memory } = decideSloAlert(e, alertMemory.get(e.sloId), now);
        if (memory) alertMemory.set(e.sloId, memory); else alertMemory.delete(e.sloId);
        if (send && (e.state === 'warning' || e.state === 'critical')) due[e.state].push(e);
    }
    for (const severity of ['critical', 'warning'] as const) {
        const list = due[severity];
        if (!list.length) continue;
        await sendAlert(
            'slo_burn_rate', severity,
            `SLO ${severity}: ${list.map((e) => e.sloId).join(', ')}`,
            list.map(describe).join('\n'),
            { evaluations: list },
        ).catch(() => { /* 알림 채널 실패는 무시 */ });
    }
    return evals;
}

export function resetSloRunnerState(): void {
    alertMemory.clear();
}
