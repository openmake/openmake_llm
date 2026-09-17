/**
 * SLO 선언 (F24.8, 145) — L2 config. 목표값은 system_settings 그룹 `slo`(DB > env > 여기 기본값)로 실시간 조정한다.
 *
 * - 비율형(ratio): 창 안의 good/total 비율이 목표 이상. 에러 버짓 = 1 - 목표. TTFT 는 "p95 ≤ 임계" 를
 *   "임계 이하 요청 비율 ≥ 95%" 로 바꿔 같은 버짓·burn-rate 계산을 쓴다.
 * - 점형(point): 최근 값 하나가 목표 이상(nightly eval 통과율) — burn-rate 없음.
 * - 알림: Google SRE 다중창 burn-rate — fast(1h·5m 둘 다 14.4배 이상) critical, slow(6h·30m 둘 다 6배 이상) warning.
 *
 * @module config/slo
 */
import { getConfig } from './env';

export const SLO_IDS = ['chat_availability', 'chat_ttft_p95', 'agent_task_success', 'eval_pass'] as const;
export type SloId = (typeof SLO_IDS)[number];
export type SloKind = 'ratio' | 'point';

export interface SloDef {
    id: SloId;
    kind: SloKind;
    /** SLI·버짓 계산 창(시간) — point 형은 참고용 */
    windowHours: number;
    /** 기본 목표(0~1) — 설정 미지정 시 */
    defaultTarget: number;
}

export const SLO_DEFS: Readonly<Record<SloId, SloDef>> = {
    chat_availability: { id: 'chat_availability', kind: 'ratio', windowHours: 30 * 24, defaultTarget: 0.99 },
    chat_ttft_p95: { id: 'chat_ttft_p95', kind: 'ratio', windowHours: 7 * 24, defaultTarget: 0.95 },
    agent_task_success: { id: 'agent_task_success', kind: 'ratio', windowHours: 7 * 24, defaultTarget: 0.85 },
    eval_pass: { id: 'eval_pass', kind: 'point', windowHours: 7 * 24, defaultTarget: 0.9 },
};

/** 다중창 burn-rate 규칙 — longHours·shortHours 둘 다 threshold 이상이면 발화 */
export const SLO_BURN_RULES = {
    fast: { longHours: 1, shortHours: 5 / 60, threshold: 14.4, severity: 'critical' },
    slow: { longHours: 6, shortHours: 0.5, threshold: 6, severity: 'warning' },
} as const;

export const SLO_LIMITS = {
    TICK_MS: parseInt(process.env.SLO_TICK_MS || '', 10) || 5 * 60_000,
    /** 부팅 직후 첫 평가 지연(마이그레이션·풀 준비 여유) */
    FIRST_TICK_DELAY_MS: 60_000,
    /** 전체 창 표본이 이보다 적으면 insufficient(판정 보류) */
    MIN_SAMPLES: 20,
    /** burn 긴 창 표본이 이보다 적으면 그 규칙은 발화하지 않는다(요청 1건 실패로 critical 방지) */
    BURN_MIN_SAMPLES: 10,
    /** 같은 SLO·같은 상태 재알림 간격 */
    REALERT_MS: 60 * 60_000,
    SNAPSHOT_RETENTION_DAYS: 400,
    HISTORY_MAX_DAYS: 90,
    /** 평가 통과율 SLO 가 읽는 러너(146 eval_runs.runner) */
    EVAL_RUNNER: 'response',
} as const;

/** 설정(DB > env) 반영 목표 — 호출 시점에 읽어 실시간 변경을 따른다. */
export function resolveSloTargets(cfg = getConfig()): { targets: Record<SloId, number>; ttftThresholdMs: number } {
    const frac = (pct: number | undefined, fallback: number) => (pct === undefined ? fallback : pct / 100);
    return {
        targets: {
            chat_availability: frac(cfg.sloChatAvailabilityTargetPct, SLO_DEFS.chat_availability.defaultTarget),
            chat_ttft_p95: SLO_DEFS.chat_ttft_p95.defaultTarget,
            agent_task_success: frac(cfg.sloAgentTaskSuccessTargetPct, SLO_DEFS.agent_task_success.defaultTarget),
            eval_pass: frac(cfg.sloEvalPassTargetPct, SLO_DEFS.eval_pass.defaultTarget),
        },
        ttftThresholdMs: cfg.sloChatTtftP95Ms,
    };
}
