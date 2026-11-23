/**
 * 모델 상태 스냅샷 (하네스 P2-7) — llm_request_metrics 를 창(WINDOW_MIN) 단위로 모델별 집계해 메모리에 둔다.
 * 요청 경로는 DB 를 기다리지 않는다: 직전 스냅샷을 즉시 읽고, 낡았으면 뒤에서 갱신한다(fail-open — 조회 실패는 빈 스냅샷 유지).
 * 키는 계측의 model 열(로컬은 서빙 모델 id, 외부는 provider 안 모델 id)이다.
 *
 * @module services/routing/model-health
 */
import { MODEL_HEALTH_ROUTING, type ModelHealthStats } from '../../config/model-health-routing';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ModelHealth');

let snapshot: { at: number; byModel: Map<string, ModelHealthStats> } = { at: 0, byModel: new Map() };
let refreshing: Promise<void> | null = null;

const SQL = `SELECT model,
        count(*)::int AS samples,
        (count(*) FILTER (WHERE error_code IS NOT NULL AND error_code <> 'aborted'))::int AS errors,
        percentile_cont(0.9) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL) AS ttft_p90,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) AS total_p50
   FROM llm_request_metrics
  WHERE created_at > NOW() - make_interval(mins => $1)
  GROUP BY model`;

export async function refreshModelHealth(now: number = Date.now()): Promise<void> {
    try {
        const { getPool } = await import('../../data/models/unified-database');
        const r = await getPool().query<{ model: string; samples: number; errors: number; ttft_p90: number | null; total_p50: number | null }>(
            SQL, [Math.max(1, Math.round(MODEL_HEALTH_ROUTING.WINDOW_MIN))]);
        const byModel = new Map<string, ModelHealthStats>();
        for (const row of r.rows) {
            byModel.set(row.model, {
                samples: Number(row.samples), errors: Number(row.errors),
                ttftP90Ms: row.ttft_p90 === null ? null : Number(row.ttft_p90),
                totalP50Ms: row.total_p50 === null ? null : Number(row.total_p50),
            });
        }
        snapshot = { at: now, byModel };
    } catch (e) {
        snapshot = { ...snapshot, at: now }; // 실패해도 매 요청 재시도하지 않게 시각만 갱신
        logger.warn(`상태 집계 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** 직전 스냅샷의 모델 집계 — 낡았으면 뒤에서 갱신을 건다(기다리지 않는다). */
export function getModelHealth(model: string, now: number = Date.now()): ModelHealthStats | undefined {
    if (now - snapshot.at >= MODEL_HEALTH_ROUTING.REFRESH_MS && !refreshing) {
        refreshing = refreshModelHealth(now).finally(() => { refreshing = null; });
    }
    return snapshot.byModel.get(model);
}

/** 테스트용 */
export function __setModelHealthSnapshot(byModel: Map<string, ModelHealthStats>, at: number = Date.now()): void {
    snapshot = { at, byModel };
}
