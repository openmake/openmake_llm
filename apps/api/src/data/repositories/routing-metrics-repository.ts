/**
 * @module data/repositories/routing-metrics-repository
 * @description 라우팅·오케스트레이션 게이트 판정용 읽기 전용 집계 계층
 *
 * measure-first 게이트 판정에 필요한 셰도우 계측 테이블 2종을 집계한다.
 * (agent-task 쪽 게이트 집계는 agent-task-metrics-repository 가 담당 — #540)
 *
 * - `orchestration_dispatch_decisions`(086/087): 오케스트레이션 자동 배정 Stage 1 의
 *   노출/호출/성공, 사용자 토글 턴의 의도 적중(재현율 프록시). 086 마이그레이션 주석의
 *   수동 분석 쿼리를 API 로 공식화한 것.
 * - `routing_shadow_decisions`(061): tail 라우팅 게이트 셰도우. TAIL_ROUTING_SHADOW_ENABLED
 *   가 기본 OFF 라 "언제까지 적재됐는가"(신선도) 자체가 관측 대상이므로 전기간 마지막
 *   적재 시각을 함께 반환한다.
 *
 * 전부 파라미터화 쿼리, read-only. 숫자 파싱(COUNT 는 문자열로 옴)은 응답 조립부에 남긴다.
 */
import { BaseRepository } from './base-repository';

/** 오케스트레이션 배정 요약 — 전체/의도/노출/호출/성공 턴 수 */
export interface OrchestrationDispatchSummaryRow {
    total_turns: string;
    intent_turns: string;
    exposed_turns: string;
    called_turns: string;
    success_turns: string;
}

/** 실제 호출된 도구별 턴 수·성공 수 */
export interface OrchestrationByToolRow {
    tool_called: string;
    turns: string;
    success_turns: string;
}

/** 사용자 수동 토글 턴에서 프리필터 의도가 잡힌 수 (재현율 프록시) */
export interface OrchestrationToggleRow {
    user_mode: string;
    turns: string;
    discussion_intent_turns: string;
    task_delegate_intent_turns: string;
}

/** tail 셰도우 요약 — 기간 내 결정 수와 전기간 마지막 적재 시각(신선도) */
export interface TailShadowSummaryRow {
    total_decisions: string;
    tail_decisions: string;
    labeled_decisions: string;
    grounding_fired_decisions: string;
    grounding_fixed_decisions: string;
    /** pg 는 TIMESTAMPTZ 를 Date 로 돌려준다 — 문자열 전제 소비처는 정규화할 것 */
    last_decision_at: Date | string | null;
}

/** verifiability 축 분포 — tail 판정과의 교차 */
export interface TailShadowVerifiabilityRow {
    verifiability: string | null;
    decisions: string;
    tail_decisions: string;
}

export class RoutingMetricsRepository extends BaseRepository {
    /**
     * 오케스트레이션 배정 요약 — 노출 대비 호출률·호출 대비 성공률의 분자/분모.
     * 비율 계산은 응답 조립부에서 수행한다.
     */
    async getOrchestrationDispatchSummary(days: number): Promise<OrchestrationDispatchSummaryRow> {
        const result = await this.query<OrchestrationDispatchSummaryRow>(
            `SELECT COUNT(*) AS total_turns,
                    COUNT(*) FILTER (WHERE discussion_intent OR task_delegate_intent) AS intent_turns,
                    COUNT(*) FILTER (WHERE cardinality(tools_exposed) > 0) AS exposed_turns,
                    COUNT(*) FILTER (WHERE tool_called IS NOT NULL) AS called_turns,
                    COUNT(*) FILTER (WHERE tool_success = true) AS success_turns
             FROM orchestration_dispatch_decisions
             WHERE created_at >= NOW() - ($1 || ' days')::interval`,
            [String(days)]
        );
        return result.rows[0] ?? {
            total_turns: '0',
            intent_turns: '0',
            exposed_turns: '0',
            called_turns: '0',
            success_turns: '0',
        };
    }

    /** 실제 호출된 도구별 턴 수·성공 수 (start_discussion / delegate_agent_task) */
    async getOrchestrationByTool(days: number): Promise<OrchestrationByToolRow[]> {
        const result = await this.query<OrchestrationByToolRow>(
            `SELECT tool_called,
                    COUNT(*) AS turns,
                    COUNT(*) FILTER (WHERE tool_success = true) AS success_turns
             FROM orchestration_dispatch_decisions
             WHERE tool_called IS NOT NULL
               AND created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY tool_called
             ORDER BY turns DESC, tool_called`,
            [String(days)]
        );
        return result.rows;
    }

    /**
     * 사용자 토글 턴의 의도 적중 — user_mode ≠ 'none' 인 턴에서 프리필터가
     * 대응 의도를 잡았는지. 자동 배정이 수동 토글을 대체할 수 있는가의 재현율 프록시.
     */
    async getOrchestrationToggleRecall(days: number): Promise<OrchestrationToggleRow[]> {
        const result = await this.query<OrchestrationToggleRow>(
            `SELECT user_mode,
                    COUNT(*) AS turns,
                    COUNT(*) FILTER (WHERE discussion_intent) AS discussion_intent_turns,
                    COUNT(*) FILTER (WHERE task_delegate_intent) AS task_delegate_intent_turns
             FROM orchestration_dispatch_decisions
             WHERE user_mode <> 'none'
               AND created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY user_mode
             ORDER BY turns DESC, user_mode`,
            [String(days)]
        );
        return result.rows;
    }

    /**
     * tail 셰도우 요약. last_decision_at 은 기간 필터 없이 전기간 MAX —
     * 셰도우 플래그가 꺼져 적재가 멈춘 상태를 그대로 보여주기 위함이다.
     */
    async getTailShadowSummary(days: number): Promise<TailShadowSummaryRow> {
        const result = await this.query<TailShadowSummaryRow>(
            `SELECT COUNT(*) AS total_decisions,
                    COUNT(*) FILTER (WHERE is_tail = true) AS tail_decisions,
                    COUNT(a_was_correct) AS labeled_decisions,
                    COUNT(*) FILTER (WHERE grounding_fired = true) AS grounding_fired_decisions,
                    COUNT(*) FILTER (WHERE grounding_fixed = true) AS grounding_fixed_decisions,
                    (SELECT MAX(created_at) FROM routing_shadow_decisions) AS last_decision_at
             FROM routing_shadow_decisions
             WHERE created_at >= NOW() - ($1 || ' days')::interval`,
            [String(days)]
        );
        return result.rows[0] ?? {
            total_decisions: '0',
            tail_decisions: '0',
            labeled_decisions: '0',
            grounding_fired_decisions: '0',
            grounding_fixed_decisions: '0',
            last_decision_at: null,
        };
    }

    /** verifiability 축 분포 — NULL(061 이전/미계산) 도 행으로 보존한다 */
    async getTailShadowByVerifiability(days: number): Promise<TailShadowVerifiabilityRow[]> {
        const result = await this.query<TailShadowVerifiabilityRow>(
            `SELECT verifiability,
                    COUNT(*) AS decisions,
                    COUNT(*) FILTER (WHERE is_tail = true) AS tail_decisions
             FROM routing_shadow_decisions
             WHERE created_at >= NOW() - ($1 || ' days')::interval
             GROUP BY verifiability
             ORDER BY decisions DESC`,
            [String(days)]
        );
        return result.rows;
    }
}
