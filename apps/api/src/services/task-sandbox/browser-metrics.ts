/**
 * Agent Task 브라우저 액션 계측 (Computer Use Stage 0).
 *
 * browser-runner.mjs 의 결과 JSON(results[])을 집계해 browser_action_metrics(079)에 영속.
 * 목적: a11y 폴백 실효 검증 + DOM/a11y 한계(canvas 신호) 실수요 측정 → Stage 1 분기 결정.
 * 순수 파서(parseBrowserMetric)와 영속(recordBrowserMetric)을 분리해 파서만 단위 테스트한다.
 *
 * @module services/task-sandbox/browser-metrics
 */
import { getPool } from '../../data/models/unified-database';
import { createLogger } from '../../utils/logger';

const logger = createLogger('BrowserMetrics');

/** CSS 셀렉터 액션(실패 시 a11y 폴백 대상). */
const SELECTOR_TYPES = new Set(['click', 'fill']);
/** a11y 폴백 액션(방금 배포한 snapshot/smartClick/smartFill). */
const A11Y_TYPES = new Set(['snapshot', 'smartClick', 'smartFill']);
/** a11y 조작 액션(발동만이 아니라 성패를 따지는 대상 — snapshot 은 발견이라 제외). */
const A11Y_ACT_TYPES = new Set(['smartClick', 'smartFill']);

export interface BrowserMetricSignal {
    totalActions: number;
    selectorActions: number;
    selectorFail: number;
    a11yAttempt: number;
    a11yFail: number;
    overallOk: boolean;
}

/** browser-runner stdout(JSON) → 집계 신호. 파싱 불가/결과 없음이면 null(잡음 미기록). */
export function parseBrowserMetric(stdout: string): BrowserMetricSignal | null {
    let obj: unknown;
    try { obj = JSON.parse(stdout); } catch { return null; }
    if (!obj || typeof obj !== 'object') return null;
    const results = (obj as { results?: unknown }).results;
    if (!Array.isArray(results)) return null;

    let selectorActions = 0, selectorFail = 0, a11yAttempt = 0, a11yFail = 0;
    for (const r of results) {
        if (!r || typeof r !== 'object') continue;
        const type = String((r as { type?: unknown }).type ?? '');
        const ok = (r as { ok?: unknown }).ok === true;
        if (SELECTOR_TYPES.has(type)) { selectorActions++; if (!ok) selectorFail++; }
        if (A11Y_TYPES.has(type)) a11yAttempt++;
        if (A11Y_ACT_TYPES.has(type) && !ok) a11yFail++;
    }
    return {
        totalActions: results.length,
        selectorActions,
        selectorFail,
        a11yAttempt,
        a11yFail,
        overallOk: (obj as { ok?: unknown }).ok === true,
    };
}

/** stdout 파싱 후 browser_action_metrics 에 1행 INSERT (fire-and-forget, fail-open). */
export function recordBrowserMetric(taskId: string, userId: string, stdout: string): void {
    const s = parseBrowserMetric(stdout);
    if (!s) return;
    getPool()
        .query(
            `INSERT INTO browser_action_metrics
                (task_id, user_id, total_actions, selector_actions, selector_fail, a11y_attempt, a11y_fail, overall_ok)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [taskId, userId, s.totalActions, s.selectorActions, s.selectorFail, s.a11yAttempt, s.a11yFail, s.overallOk],
        )
        .catch((e) => logger.warn(`browser 계측 기록 실패(무시): ${e instanceof Error ? e.message : String(e)}`));
}
