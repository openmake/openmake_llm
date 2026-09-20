/**
 * 모델 전환 게이트 (오픈웨이트 전환 S2) — PURE.
 *
 * 절차 "프로필 추가 → `eval:matrix` 통과 → 전환" 의 "통과" 를 판정한다. 저장된 기준선이 아니라 **같은 실행 안의 현행 모델 셀**과
 * 비교한다 — 같은 케이스·같은 시각·같은 서빙 상태라 기준선 낡음(케이스 교체·서버 부하)이 판정을 흐리지 않는다.
 *
 *   npm run eval:matrix -- --real --models <현행>,<후보> --gate <후보> [--incumbent <현행>]
 *
 * variant 마다 따로 본다(스타일·thinking 에서만 무너지는 모델을 평균이 가린다). 한 variant 라도 떨어지면 전환 불가.
 *
 * @module evaluation/model-switch-gate
 */
import type { EvalRunRecord } from '../data/repositories/eval-run-repository';

export interface ModelSwitchThresholds {
    /** 후보의 절대 통과율 하한 (0~1) */
    minPassRate: number;
    /** 현행 대비 통과율 하락 허용폭 (0~1, 0.05 = 5%p) */
    maxPassRateDrop: number;
    /** 현행 대비 전체 p95 지연 증가 허용 비율 (%). 지연을 못 잰 셀은 비교하지 않는다 */
    maxLatencyRegressionPct: number;
    /** 절대 증가가 이보다 작으면 비율이 커도 회귀로 보지 않는다(짧은 지연의 잡음) */
    minLatencyAbsDeltaMs: number;
}

function envNumber(name: string, fallback: number): number {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && process.env[name] !== undefined && process.env[name] !== '' ? v : fallback;
}

export function modelSwitchThresholds(): ModelSwitchThresholds {
    return {
        minPassRate: envNumber('OMK_EVAL_SWITCH_MIN_PASS_RATE', 0.8),
        maxPassRateDrop: envNumber('OMK_EVAL_SWITCH_MAX_PASS_DROP', 0.05),
        maxLatencyRegressionPct: envNumber('OMK_EVAL_SWITCH_MAX_LATENCY_REGRESSION_PCT', 50),
        minLatencyAbsDeltaMs: envNumber('OMK_EVAL_SWITCH_MIN_LATENCY_ABS_DELTA_MS', 4_000),
    };
}

export interface ModelSwitchRow {
    variant: string;
    incumbentPassRate: number | null;
    candidatePassRate: number;
    incumbentP95Ms: number | null;
    candidateP95Ms: number | null;
    failures: string[];
}

export interface ModelSwitchVerdict {
    ok: boolean;
    candidate: string;
    incumbent: string | null;
    rows: ModelSwitchRow[];
    /** 판정 자체가 불가능한 사유(후보 셀 없음 등) — 있으면 ok=false */
    reason?: string;
}

type Cell = Pick<EvalRunRecord, 'model' | 'variant' | 'passRate' | 'totalCases' | 'totalP95Ms'>;

export function judgeModelSwitch(
    cells: readonly Cell[],
    params: { candidate: string; incumbent?: string | null },
    t: ModelSwitchThresholds,
): ModelSwitchVerdict {
    const incumbent = params.incumbent ?? null;
    const base = { candidate: params.candidate, incumbent };
    const candidateCells = cells.filter((c) => c.model === params.candidate);
    if (candidateCells.length === 0) return { ...base, ok: false, rows: [], reason: `후보 '${params.candidate}' 의 셀이 없습니다 — --models 에 후보를 포함하세요` };
    if (candidateCells.some((c) => c.totalCases === 0)) return { ...base, ok: false, rows: [], reason: '케이스 0건 — 판정할 수 없습니다' };
    if (incumbent && incumbent === params.candidate) return { ...base, ok: false, rows: [], reason: '현행과 후보가 같은 모델입니다' };

    const rows = candidateCells.map((c): ModelSwitchRow => {
        const variant = c.variant ?? 'base';
        const inc = incumbent ? cells.find((x) => x.model === incumbent && (x.variant ?? 'base') === variant) : undefined;
        const failures: string[] = [];
        if (c.passRate < t.minPassRate) failures.push(`통과율 ${(c.passRate * 100).toFixed(1)}% < 하한 ${(t.minPassRate * 100).toFixed(1)}%`);
        if (incumbent && !inc) failures.push(`현행 '${incumbent}' 의 같은 variant 셀이 없어 비교 불가`);
        if (inc && inc.passRate - c.passRate > t.maxPassRateDrop) {
            failures.push(`현행 대비 통과율 -${((inc.passRate - c.passRate) * 100).toFixed(1)}%p > 허용 ${(t.maxPassRateDrop * 100).toFixed(1)}%p`);
        }
        const ip95 = inc?.totalP95Ms ?? null;
        const cp95 = c.totalP95Ms ?? null;
        if (ip95 !== null && cp95 !== null && ip95 > 0) {
            const delta = cp95 - ip95;
            const pct = (delta / ip95) * 100;
            if (delta > t.minLatencyAbsDeltaMs && pct > t.maxLatencyRegressionPct) {
                failures.push(`p95 지연 +${pct.toFixed(0)}% (${(ip95 / 1000).toFixed(1)}s → ${(cp95 / 1000).toFixed(1)}s) > 허용 ${t.maxLatencyRegressionPct}%`);
            }
        }
        return { variant, incumbentPassRate: inc?.passRate ?? null, candidatePassRate: c.passRate, incumbentP95Ms: ip95, candidateP95Ms: cp95, failures };
    });
    return { ...base, ok: rows.every((r) => r.failures.length === 0), rows };
}

export function renderModelSwitchVerdict(v: ModelSwitchVerdict): string {
    const head = `[전환 게이트] 후보 ${v.candidate}${v.incumbent ? ` ↔ 현행 ${v.incumbent}` : ' (현행 비교 없음 — 절대 하한만)'}: ${v.ok ? '통과' : '불가'}`;
    if (v.reason) return `${head}\n  - ${v.reason}`;
    const lines = v.rows.map((r) => {
        const inc = r.incumbentPassRate === null ? '—' : `${(r.incumbentPassRate * 100).toFixed(1)}%`;
        const verdict = r.failures.length ? `불가 — ${r.failures.join(' / ')}` : '통과';
        return `  - ${r.variant}: 현행 ${inc} → 후보 ${(r.candidatePassRate * 100).toFixed(1)}% · ${verdict}`;
    });
    return [head, ...lines].join('\n');
}
