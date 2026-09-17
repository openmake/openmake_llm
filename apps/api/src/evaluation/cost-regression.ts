/**
 * nightly 비용 회귀 판정 (F26.8 nightly 층 확장, S6) — PURE.
 *
 * 실모델 응답 평가(--real)의 케이스 계측(입력·출력 토큰)에 로컬 llm.local 단가(cost_rates → env
 * LOCAL_LLM_COST_* → 0)를 곱해 추정 비용을 기준선과 비교한다. latency-regression.ts 와 같은 패턴
 * (같은 기준선 파일 구조·같은 케이스 집합/모델일 때만 비교)이다.
 *
 * 단가 해석(DB 조회)은 이 모듈이 하지 않는다 — PURE 유지를 위해 호출부(run-response-evaluation.ts)가
 * services/cost/cost-ledger-service.resolveRate 로 구한 rate 를 넘겨준다.
 *
 * @module evaluation/cost-regression
 */
import { percentile, type CaseTiming } from './eval-run-recorder';

export interface CostRates {
    /** micros per input token */
    inputPerTokenMicros: number;
    /** micros per output token */
    outputPerTokenMicros: number;
}

export interface CostMetrics {
    totalCostUsdMicros: number;
    costP50UsdMicros: number | null;
}

export interface CostBaseline {
    datasetVersion: string;
    caseIds: string[];
    model: string | null;
    metrics: CostMetrics;
    updatedAt: string;
}

export interface CostRow { metric: keyof CostMetrics; baseline: number | null; current: number | null; deltaPct: number | null; regressed: boolean }

/** 절대 변화가 이보다 작으면 비율이 커도 회귀로 보지 않는다(소액 잡음) */
export const COST_MIN_ABS_DELTA: Readonly<Record<keyof CostMetrics, number>> = {
    totalCostUsdMicros: 1_000, // $0.001
    costP50UsdMicros: 50,
};

/** PURE: 케이스 1건 비용(micros) = 입력토큰*inputRate + 출력토큰*outputRate. 토큰 미계측이면 0. */
export function caseCostUsdMicros(t: CaseTiming, rates: CostRates): number {
    return Math.round((t.inputTokens ?? 0) * rates.inputPerTokenMicros + (t.outputTokens ?? 0) * rates.outputPerTokenMicros);
}

export function costMetrics(timings: CaseTiming[], rates: CostRates): CostMetrics {
    const costs = timings.map((t) => caseCostUsdMicros(t, rates));
    return {
        totalCostUsdMicros: costs.reduce((sum, c) => sum + c, 0),
        costP50UsdMicros: percentile(costs, 50),
    };
}

export function compareCost(
    current: CostMetrics,
    currentCases: { datasetVersion: string; caseIds: string[]; model: string | null },
    baseline: CostBaseline | null,
    regressionPct: number,
): { comparable: boolean; reason?: string; rows: CostRow[]; ok: boolean } {
    if (!baseline) return { comparable: false, reason: '기준선 없음', rows: [], ok: true };
    const sameCases = baseline.datasetVersion === currentCases.datasetVersion
        && baseline.caseIds.length === currentCases.caseIds.length
        && baseline.caseIds.every((id, i) => id === currentCases.caseIds[i]);
    if (!sameCases) return { comparable: false, reason: `케이스 집합이 기준선과 다름(기준선 v${baseline.datasetVersion} ${baseline.caseIds.length}건)`, rows: [], ok: true };
    if ((baseline.model ?? null) !== (currentCases.model ?? null)) return { comparable: false, reason: `모델이 기준선과 다름(${baseline.model ?? 'default'})`, rows: [], ok: true };
    const rows: CostRow[] = (Object.keys(COST_MIN_ABS_DELTA) as Array<keyof CostMetrics>).map((metric) => {
        const b = baseline.metrics[metric];
        const c = current[metric];
        if (b === null || c === null || b <= 0) return { metric, baseline: b, current: c, deltaPct: null, regressed: false };
        const deltaPct = Math.round(((c - b) / b) * 1000) / 10;
        const regressed = deltaPct > regressionPct && c - b >= COST_MIN_ABS_DELTA[metric];
        return { metric, baseline: b, current: c, deltaPct, regressed };
    });
    return { comparable: true, rows, ok: rows.every((r) => !r.regressed) };
}

export function renderCostTable(rows: CostRow[]): string {
    return ['| 지표 | 기준선(micros) | 현재(micros) | 변화 | 판정 |', '|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.metric} | ${r.baseline ?? '—'} | ${r.current ?? '—'} | ${r.deltaPct === null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`} | ${r.regressed ? '❌ 회귀' : '✅'} |`),
    ].join('\n');
}
