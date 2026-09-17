/**
 * 프롬프트·도구 스키마 크기 예산(F26.8 CI 층) — PURE.
 *
 * CI 는 LLM 에 닿지 못해 지연을 직접 잴 수 없다. 첫 토큰 지연의 지배 요인인 시스템 프롬프트 정적 prefix·
 * 전체 길이와 상시 노출 도구 스키마 크기를 기준선 대비 증가율로 막는다(CLAUDE.md "첫 토큰 지연의 주원인은
 * prefix cache miss"). 정당한 증가는 `--update-baseline` 으로 기준선 파일을 같은 PR 에서 갱신한다.
 *
 * @module evaluation/budget-evaluation
 */

export interface BudgetMeasurement {
    /** 컨텍스트별 정적 prefix·전체 시스템 프롬프트 길이(문자) */
    contexts: Record<string, { staticChars: number; fullChars: number }>;
    /** 상시 노출 도구 스키마 JSON 바이트 */
    alwaysOnToolSchemaBytes: number;
}

export interface BudgetBaseline extends BudgetMeasurement {
    updatedAt: string;
}

export interface BudgetRow {
    metric: string;
    baseline: number | null;
    current: number;
    /** 기준선 대비 증가율(%) — 기준선이 없으면 null */
    driftPct: number | null;
    ok: boolean;
    reason?: string;
}

export interface BudgetLimits {
    /** 기준선 대비 허용 증가율(%) */
    driftPct: number;
    /** 절대 상한(선택) — 정적 prefix 문자 수 */
    maxStaticChars?: number;
    /** 절대 상한(선택) — 상시 노출 도구 스키마 바이트 */
    maxToolSchemaBytes?: number;
}

function row(metric: string, current: number, baseline: number | undefined, limits: BudgetLimits, absoluteMax?: number): BudgetRow {
    const driftPct = baseline && baseline > 0 ? ((current - baseline) / baseline) * 100 : null;
    if (absoluteMax !== undefined && current > absoluteMax) {
        return { metric, baseline: baseline ?? null, current, driftPct, ok: false, reason: `절대 상한 ${absoluteMax} 초과` };
    }
    if (baseline === undefined) {
        // 새 컨텍스트는 기준선이 생길 때까지 실패로 두지 않는다 — 갱신 누락은 리포트로 드러난다
        return { metric, baseline: null, current, driftPct: null, ok: true, reason: '기준선 없음(--update-baseline 필요)' };
    }
    const ok = driftPct === null || driftPct <= limits.driftPct;
    return { metric, baseline, current, driftPct, ok, ...(ok ? {} : { reason: `+${driftPct!.toFixed(1)}% > 허용 ${limits.driftPct}%` }) };
}

/** 측정값을 기준선과 비교 — 줄어드는 것은 항상 통과. */
export function compareBudget(current: BudgetMeasurement, baseline: BudgetMeasurement | null, limits: BudgetLimits): { rows: BudgetRow[]; ok: boolean } {
    const rows: BudgetRow[] = [];
    for (const [id, m] of Object.entries(current.contexts)) {
        const b = baseline?.contexts[id];
        rows.push(row(`${id}.staticChars`, m.staticChars, b?.staticChars, limits, limits.maxStaticChars));
        rows.push(row(`${id}.fullChars`, m.fullChars, b?.fullChars, limits));
    }
    rows.push(row('alwaysOnToolSchemaBytes', current.alwaysOnToolSchemaBytes, baseline?.alwaysOnToolSchemaBytes, limits, limits.maxToolSchemaBytes));
    return { rows, ok: rows.every((r) => r.ok) };
}

/** 마크다운 표(콘솔·PR 코멘트 공용). */
export function renderBudgetTable(rows: BudgetRow[]): string {
    const lines = ['| 지표 | 기준선 | 현재 | 증가율 | 상태 |', '|---|---|---|---|---|'];
    for (const r of rows) {
        const drift = r.driftPct === null ? 'n/a' : `${r.driftPct >= 0 ? '+' : ''}${r.driftPct.toFixed(1)}%`;
        lines.push(`| ${r.metric} | ${r.baseline ?? 'n/a'} | ${r.current} | ${drift} | ${r.ok ? '✅' : '❌'}${r.reason ? ` ${r.reason}` : ''} |`);
    }
    return lines.join('\n');
}
