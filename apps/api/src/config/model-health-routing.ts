/**
 * 모델 상태 기반 라우팅 (하네스 P2-7) — 최근 실측(llm_request_metrics, 158)으로 사용자가 고른 모델이 비정상이면
 * 대체 후보 중 건강한 모델을 **단가 → 지연** 순으로 고른다. 판정은 집계값과 임계값뿐이다(앞단 LLM 판단 없음 — A형 금지).
 *
 * 비정상: 창(WINDOW_MIN) 안 표본이 MIN_SAMPLES 이상이고, 오류율(취소 제외) ≥ ERROR_RATE 이거나 첫 토큰 p90 ≥ TTFT_P90_MS.
 * 대체 후보: ALTERNATES(fullId 목록, 선언 순) + 채팅 기본 모델(항상 마지막 후보). 후보 자신이 비정상이면 건너뛴다.
 * 표본이 부족한 후보는 "모름" 이라 막지 않는다 — 대신 같은 단가에선 실측이 있는 쪽이 앞선다.
 *
 * 기본 OFF(종전 — 고른 모델 그대로). MODEL_HEALTH_ROUTING_ENABLED=true 로 켠다.
 *
 * @module config/model-health-routing
 */

const num = (v: string | undefined, def: number): number => {
    const n = Number(v);
    return v !== undefined && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : def;
};

export const MODEL_HEALTH_ROUTING = {
    ENABLED: process.env.MODEL_HEALTH_ROUTING_ENABLED === 'true',
    /** 집계 창(분) */
    WINDOW_MIN: num(process.env.MODEL_HEALTH_ROUTING_WINDOW_MIN, 15),
    /** 판정에 필요한 최소 표본 수 */
    MIN_SAMPLES: num(process.env.MODEL_HEALTH_ROUTING_MIN_SAMPLES, 5),
    /** 오류율 임계(0~1, 취소 제외) */
    ERROR_RATE: num(process.env.MODEL_HEALTH_ROUTING_ERROR_RATE, 0.5),
    /** 첫 토큰 p90 임계(ms) — 0 이면 지연으로는 판정하지 않는다 */
    TTFT_P90_MS: num(process.env.MODEL_HEALTH_ROUTING_TTFT_P90_MS, 90_000),
    /** 스냅샷 갱신 주기(ms) — 요청 경로는 기다리지 않고 직전 스냅샷을 쓴다 */
    REFRESH_MS: num(process.env.MODEL_HEALTH_ROUTING_REFRESH_MS, 60_000),
    /** 대체 후보 fullId(쉼표 구분, 선언 순) — 비우면 채팅 기본 모델만 */
    ALTERNATES: (process.env.MODEL_HEALTH_ROUTING_ALTERNATES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};

export interface ModelHealthStats {
    samples: number;
    errors: number;
    ttftP90Ms: number | null;
    totalP50Ms: number | null;
}

export type HealthVerdict = 'healthy' | 'unhealthy' | 'unknown';

export interface HealthThresholds { minSamples: number; errorRate: number; ttftP90Ms: number }

const cfgThresholds = (): HealthThresholds => ({
    minSamples: MODEL_HEALTH_ROUTING.MIN_SAMPLES, errorRate: MODEL_HEALTH_ROUTING.ERROR_RATE, ttftP90Ms: MODEL_HEALTH_ROUTING.TTFT_P90_MS,
});

/** PURE: 집계 → 판정. 사유는 로그·고지용 짧은 코드. */
export function judgeHealth(s: ModelHealthStats | undefined, t: HealthThresholds = cfgThresholds()): { verdict: HealthVerdict; reason: string | null } {
    if (!s || s.samples < Math.max(1, t.minSamples)) return { verdict: 'unknown', reason: null };
    if (s.errors / s.samples >= t.errorRate) return { verdict: 'unhealthy', reason: 'error_rate' };
    if (t.ttftP90Ms > 0 && s.ttftP90Ms !== null && s.ttftP90Ms >= t.ttftP90Ms) return { verdict: 'unhealthy', reason: 'ttft_p90' };
    return { verdict: 'healthy', reason: null };
}

export interface RouteCandidate {
    fullId: string;
    /** 토큰당 단가(입력+출력, micros) — 순서 비교용 */
    unitCost: number;
    stats?: ModelHealthStats;
}

/** PURE: 대체 후보 순서 — 비정상 제외, 단가 오름차순, 같으면 실측 있는 쪽·지연(p50) 짧은 쪽, 그다음 선언 순. */
export function rankAlternates(cands: readonly RouteCandidate[], t: HealthThresholds = cfgThresholds()): RouteCandidate[] {
    return cands
        .map((c, i) => ({ c, i, v: judgeHealth(c.stats, t).verdict }))
        .filter((x) => x.v !== 'unhealthy')
        .sort((a, b) =>
            a.c.unitCost - b.c.unitCost
            || (a.v === b.v ? 0 : a.v === 'healthy' ? -1 : 1)
            || (a.c.stats?.totalP50Ms ?? Infinity) - (b.c.stats?.totalP50Ms ?? Infinity)
            || a.i - b.i)
        .map((x) => x.c);
}
