/**
 * 가드 발동 집계의 순수 부분 — 단계 기록 한 줄을 현상으로 분류하고, 현상별 발동 건수와 겪은 작업 수를 센다.
 * 실행기는 run-guard-stats.ts, 표지는 guard-stats-markers.ts.
 *
 * @module evaluation/guard-stats
 */
import { GUARD_STEP_MARKERS } from './guard-stats-markers';

export interface GuardStepRow {
    task_id: string;
    step_type: string;
    content: string | null;
}

export interface GuardTaskRow {
    id: string;
    status: string | null;
    failure_class: string | null;
    current_turn: number | null;
    /** 서버 재시작 정리(schema-initializer 의 좀비 정리)로 끊긴 적이 있는가 — agent_task_events 의 'server restarted' 전이. */
    restarted?: boolean;
}

export interface TurnDistribution {
    n: number; min: number; p50: number; p90: number; max: number; mean: number;
    /** 턴 수 → 작업 수. */
    histogram: Record<number, number>;
}

export interface GuardPhenomenon {
    id: string;
    label: string;
    /** 발동 건수(스텝 수). */
    occurrences: number;
    /** 한 번이라도 겪은 작업 수. */
    tasks: number;
}

export interface GuardStats {
    tasks: {
        total: number;
        /** 재시작 정리로 끊긴 작업 수 — 기록상 failed 지만 작업 탓이 아니라 아래 상태·실패 분류에서 뺀다(평가 실행기가 여럿 돌 때 많이 생긴다). */
        restartInterrupted: number;
        byStatus: Record<string, number>;
        byFailureClass: Record<string, number>;
        turns: TurnDistribution;
    };
    phenomena: GuardPhenomenon[];
}

/** PURE: 스텝 한 줄이 해당하는 현상 id 들. */
export function classifyGuardStep(row: GuardStepRow): string[] {
    const content = row.content ?? '';
    return GUARD_STEP_MARKERS
        .filter((m) => m.stepType === row.step_type && (!m.pattern || m.pattern.test(content)))
        .map((m) => m.id);
}

/** PURE: 턴 수 분포 — 분위는 정렬한 값에서 올림 순위로 고른다(보간 없음). */
export function turnDistribution(turns: readonly number[]): TurnDistribution {
    if (turns.length === 0) return { n: 0, min: 0, p50: 0, p90: 0, max: 0, mean: 0, histogram: {} };
    const sorted = [...turns].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
    const histogram: Record<number, number> = {};
    for (const t of sorted) histogram[t] = (histogram[t] ?? 0) + 1;
    return {
        n: sorted.length, min: sorted[0], p50: at(0.5), p90: at(0.9), max: sorted[sorted.length - 1],
        mean: Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 100) / 100, histogram,
    };
}

const countBy = (keys: readonly string[]): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const k of keys) out[k] = (out[k] ?? 0) + 1;
    return out;
};

/** 스텝을 나눠 읽으며 누적하는 집계기 — add 로 배치를 넣고 result 로 꺼낸다. */
export function createGuardStepCounter(): { add: (rows: readonly GuardStepRow[]) => void; result: () => GuardPhenomenon[] } {
    const occurrences = new Map<string, number>();
    const tasks = new Map<string, Set<string>>();
    return {
        add: (rows) => {
            for (const row of rows) {
                for (const id of classifyGuardStep(row)) {
                    occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
                    if (!tasks.has(id)) tasks.set(id, new Set());
                    tasks.get(id)!.add(row.task_id);
                }
            }
        },
        result: () => GUARD_STEP_MARKERS.map((m) => ({
            id: m.id, label: m.label, occurrences: occurrences.get(m.id) ?? 0, tasks: tasks.get(m.id)?.size ?? 0,
        })),
    };
}

/** PURE: 작업 행과 스텝 행으로 집계를 만든다. */
export function summarizeGuardStats(taskRows: readonly GuardTaskRow[], stepRows: readonly GuardStepRow[]): GuardStats {
    const counter = createGuardStepCounter();
    counter.add(stepRows);
    const counted = taskRows.filter((t) => !t.restarted);
    return {
        tasks: {
            total: taskRows.length,
            restartInterrupted: taskRows.length - counted.length,
            byStatus: countBy(counted.map((t) => t.status ?? 'unknown')),
            byFailureClass: countBy(counted.filter((t) => t.failure_class).map((t) => t.failure_class as string)),
            turns: turnDistribution(taskRows.map((t) => Number(t.current_turn ?? 0))),
        },
        phenomena: counter.result(),
    };
}

/** PURE: 기간 인자 — "7d"(N일 전) 또는 날짜 문자열. 없으면 undefined, 못 읽으면 던진다. */
export function parseSince(value: string | undefined, nowMs: number): Date | undefined {
    if (value === undefined) return undefined;
    const days = /^(\d+)d$/.exec(value);
    const at = days ? new Date(nowMs - Number(days[1]) * 86_400_000) : new Date(value);
    if (Number.isNaN(at.getTime())) throw new Error(`기간을 읽을 수 없습니다: ${value} (예: 7d, 2026-10-01)`);
    return at;
}
