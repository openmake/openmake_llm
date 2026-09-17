/**
 * SLO 평가기 (F24.8) — PURE. SLI·에러 버짓 잔량·다중창 burn-rate·상태와 알림 여부를 계산한다.
 * 데이터 조회는 data/repositories/slo-repository, 실행·적재·알림은 monitoring/slo-runner.
 *
 * @module monitoring/slo-evaluator
 */
import { SLO_BURN_RULES, SLO_LIMITS, type SloId } from '../config/slo';

export type SloState = 'ok' | 'warning' | 'critical' | 'insufficient';

const BURN_EPSILON = 1e-9;

export interface RatioCounts {
    total: number;
    bad: number;
}

export interface SloEvaluation {
    sloId: SloId;
    windowHours: number;
    target: number;
    sliValue: number | null;
    sampleCount: number;
    /** 0~1 — 창 전체 기준 남은 에러 버짓(소진 시 0) */
    budgetRemaining: number | null;
    burnRateFast: number | null;
    burnRateSlow: number | null;
    state: SloState;
    /** 상태 사유 — fast_burn | slow_burn | budget_exhausted | below_target | few_samples */
    reason?: string;
    detail?: Record<string, unknown>;
}

/** 에러율 / 에러 버짓. 표본 0 이면 null. 버짓 0(목표 100%)이면 오류가 하나라도 있을 때 Infinity. */
export function burnRate(c: RatioCounts, target: number): number | null {
    if (c.total <= 0) return null;
    const budget = 1 - target;
    const errorRate = c.bad / c.total;
    if (budget <= 0) return errorRate > 0 ? Infinity : 0;
    return errorRate / budget;
}

export function budgetRemaining(c: RatioCounts, target: number): number | null {
    const br = burnRate(c, target);
    if (br === null) return null;
    return Math.max(0, Math.min(1, 1 - br));
}

function rounded(n: number | null, digits = 4): number | null {
    if (n === null || !Number.isFinite(n)) return n;
    const f = 10 ** digits;
    return Math.round(n * f) / f;
}

/** 규칙 하나의 발화 여부 — 긴 창 표본 하한을 넘고 긴·짧은 창 모두 임계 이상. */
function ruleFires(long: RatioCounts, short: RatioCounts, target: number, threshold: number): boolean {
    if (long.total < SLO_LIMITS.BURN_MIN_SAMPLES) return false;
    const bl = burnRate(long, target);
    const bs = burnRate(short, target);
    // 부동소수 오차 허용 — 0.144/0.01 = 14.3999… 가 임계 14.4 에 못 미치는 것을 막는다
    return bl !== null && bs !== null && bl >= threshold - BURN_EPSILON && bs >= threshold - BURN_EPSILON;
}

export interface RatioSloInput {
    sloId: SloId;
    windowHours: number;
    target: number;
    /** 창 전체와 burn 규칙 창(시간 → 집계) */
    counts: {
        window: RatioCounts;
        fastLong: RatioCounts;
        fastShort: RatioCounts;
        slowLong: RatioCounts;
        slowShort: RatioCounts;
    };
    detail?: Record<string, unknown>;
}

export function evaluateRatioSlo(input: RatioSloInput): SloEvaluation {
    const { window, fastLong, fastShort, slowLong, slowShort } = input.counts;
    const base = {
        sloId: input.sloId,
        windowHours: input.windowHours,
        target: input.target,
        sampleCount: window.total,
        sliValue: window.total > 0 ? rounded((window.total - window.bad) / window.total) : null,
        budgetRemaining: rounded(budgetRemaining(window, input.target)),
        burnRateFast: rounded(burnRate(fastLong, input.target), 2),
        burnRateSlow: rounded(burnRate(slowLong, input.target), 2),
        ...(input.detail ? { detail: input.detail } : {}),
    };
    if (window.total < SLO_LIMITS.MIN_SAMPLES) return { ...base, state: 'insufficient', reason: 'few_samples' };
    if (ruleFires(fastLong, fastShort, input.target, SLO_BURN_RULES.fast.threshold)) return { ...base, state: 'critical', reason: 'fast_burn' };
    if (ruleFires(slowLong, slowShort, input.target, SLO_BURN_RULES.slow.threshold)) return { ...base, state: 'warning', reason: 'slow_burn' };
    if (base.budgetRemaining === 0) return { ...base, state: 'warning', reason: 'budget_exhausted' };
    return { ...base, state: 'ok' };
}

export function evaluatePointSlo(input: { sloId: SloId; windowHours: number; target: number; value: number | null; sampleCount: number; detail?: Record<string, unknown> }): SloEvaluation {
    const base = {
        sloId: input.sloId, windowHours: input.windowHours, target: input.target,
        sliValue: input.value === null ? null : rounded(input.value), sampleCount: input.sampleCount,
        budgetRemaining: null, burnRateFast: null, burnRateSlow: null,
        ...(input.detail ? { detail: input.detail } : {}),
    };
    if (input.value === null || input.sampleCount <= 0) return { ...base, state: 'insufficient', reason: 'few_samples' };
    return input.value >= input.target ? { ...base, state: 'ok' } : { ...base, state: 'warning', reason: 'below_target' };
}

const SEVERITY_RANK: Readonly<Record<SloState, number>> = { insufficient: 0, ok: 0, warning: 1, critical: 2 };

export interface SloAlertMemory { state: SloState; at: number }

/**
 * 알림 여부 — warning/critical 이고 ① 직전 알림보다 심각해졌거나 ② 같은 상태로 REALERT_MS 가 지났을 때.
 * ok/insufficient 로 돌아오면 기억을 지워 다음 악화 때 바로 알린다.
 */
export function decideSloAlert(ev: SloEvaluation, prev: SloAlertMemory | undefined, now: number): { send: boolean; memory: SloAlertMemory | undefined } {
    const rank = SEVERITY_RANK[ev.state];
    if (rank === 0) return { send: false, memory: undefined };
    if (!prev || rank > SEVERITY_RANK[prev.state] || now - prev.at >= SLO_LIMITS.REALERT_MS) {
        return { send: true, memory: { state: ev.state, at: now } };
    }
    return { send: false, memory: prev };
}
