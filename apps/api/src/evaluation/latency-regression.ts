/**
 * nightly 지연 회귀 판정 (F26.8 nightly 층) — PURE.
 *
 * 실모델 응답 평가(--real)의 케이스 계측(첫 토큰·전체 시간·출력 토큰)을 기준선과 비교한다. 같은 케이스 집합(데이터셋 버전·케이스 id)
 * 일 때만 비교하고, 다르면 판정을 건너뛴다(케이스가 바뀌면 지연 분포가 달라 회귀와 구분할 수 없다).
 *
 * @module evaluation/latency-regression
 */
import { percentile, type CaseTiming } from './eval-run-recorder';

export interface LatencyMetrics {
    ttftP50Ms: number | null;
    ttftP95Ms: number | null;
    totalP50Ms: number | null;
    totalP95Ms: number | null;
    outputTokensP50: number | null;
}

export interface LatencyBaseline {
    datasetVersion: string;
    caseIds: string[];
    model: string | null;
    metrics: LatencyMetrics;
    updatedAt: string;
}

export interface LatencyRow { metric: keyof LatencyMetrics; baseline: number | null; current: number | null; deltaPct: number | null; regressed: boolean }

/** 절대 변화가 이보다 작으면 비율이 커도 회귀로 보지 않는다(짧은 지연의 잡음) */
export const LATENCY_MIN_ABS_DELTA: Readonly<Record<keyof LatencyMetrics, number>> = {
    ttftP50Ms: 1_000, ttftP95Ms: 2_000, totalP50Ms: 2_000, totalP95Ms: 4_000, outputTokensP50: 50,
};

export function latencyMetrics(timings: CaseTiming[]): LatencyMetrics {
    const ttft = timings.map((t) => t.ttftMs).filter((v): v is number => typeof v === 'number');
    const total = timings.map((t) => t.totalMs);
    const out = timings.map((t) => t.outputTokens).filter((v): v is number => typeof v === 'number');
    return {
        ttftP50Ms: percentile(ttft, 50), ttftP95Ms: percentile(ttft, 95),
        totalP50Ms: percentile(total, 50), totalP95Ms: percentile(total, 95),
        outputTokensP50: percentile(out, 50),
    };
}

export function compareLatency(
    current: LatencyMetrics,
    currentCases: { datasetVersion: string; caseIds: string[]; model: string | null },
    baseline: LatencyBaseline | null,
    regressionPct: number,
): { comparable: boolean; reason?: string; rows: LatencyRow[]; ok: boolean } {
    if (!baseline) return { comparable: false, reason: '기준선 없음', rows: [], ok: true };
    const sameCases = baseline.datasetVersion === currentCases.datasetVersion
        && baseline.caseIds.length === currentCases.caseIds.length
        && baseline.caseIds.every((id, i) => id === currentCases.caseIds[i]);
    if (!sameCases) return { comparable: false, reason: `케이스 집합이 기준선과 다름(기준선 v${baseline.datasetVersion} ${baseline.caseIds.length}건)`, rows: [], ok: true };
    if ((baseline.model ?? null) !== (currentCases.model ?? null)) return { comparable: false, reason: `모델이 기준선과 다름(${baseline.model ?? 'default'})`, rows: [], ok: true };
    const rows: LatencyRow[] = (Object.keys(LATENCY_MIN_ABS_DELTA) as Array<keyof LatencyMetrics>).map((metric) => {
        const b = baseline.metrics[metric];
        const c = current[metric];
        if (b === null || c === null || b <= 0) return { metric, baseline: b, current: c, deltaPct: null, regressed: false };
        const deltaPct = Math.round(((c - b) / b) * 1000) / 10;
        const regressed = deltaPct > regressionPct && c - b >= LATENCY_MIN_ABS_DELTA[metric];
        return { metric, baseline: b, current: c, deltaPct, regressed };
    });
    return { comparable: true, rows, ok: rows.every((r) => !r.regressed) };
}

export function renderLatencyTable(rows: LatencyRow[]): string {
    return ['| 지표 | 기준선 | 현재 | 변화 | 판정 |', '|---|---|---|---|---|',
        ...rows.map((r) => `| ${r.metric} | ${r.baseline ?? '—'} | ${r.current ?? '—'} | ${r.deltaPct === null ? '—' : `${r.deltaPct > 0 ? '+' : ''}${r.deltaPct}%`} | ${r.regressed ? '❌ 회귀' : '✅'} |`),
    ].join('\n');
}
