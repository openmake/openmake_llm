/**
 * @module data/repositories/ops-metrics-repository
 * @description `ops_metrics` 내장 도구용 읽기 전용 집계 (2026-09-07)
 *
 * 기존 저장소가 덮지 않는 그레인만 둔다 — 도구 단위 건전성은 `tool-health-repository`,
 * 판정 분포·실패 사유는 `agent-task-metrics-repository` 를 재사용한다(도구 핸들러가 조립).
 * 기간은 **시간** 단위(`hours`) — 기존 저장소의 `days` 와 달리 "지난 1시간" 을 표현해야 한다.
 * 전부 파라미터화·read-only. COUNT/SUM 은 문자열로 온다(파싱은 조립부).
 */
import { BaseRepository } from './base-repository';

export interface OpsRunRow {
    id: string;
    user_id: string;
    status: string;
    model: string | null;
    goal: string;
    error: string | null;
    judge_verdict: string | null;
    duration_s: string | null;
    total_tokens: number | null;
    created_at: Date;
}

export interface OpsRunsSummaryRow {
    status: string;
    runs: string;
    avg_duration_s: string | null;
    avg_tokens: string | null;
    goal_incomplete: string;
}

export interface OpsRunsByModelRow {
    model: string | null;
    runs: string;
    failed: string;
    avg_duration_s: string | null;
    avg_tokens: string | null;
}

export interface OpsToolServerRow {
    server: string | null;
    calls: string;
    errors: string;
    p50_duration_ms: string | null;
    last_error_at: Date | null;
}

export interface OpsProviderUsageRow {
    provider_id: string;
    model_id: string;
    requests: string;
    input_tokens: string | null;
    output_tokens: string | null;
    cost_usd_micros: string | null;
    avg_duration_ms: string | null;
    errors: string;
}

export interface OpsTaskTokensByUserRow {
    user_id: string;
    runs: string;
    total_tokens: string | null;
}

const WINDOW = `NOW() - ($1 || ' hours')::interval`;
const DURATION = `EXTRACT(EPOCH FROM (COALESCE(completed_at, updated_at) - created_at))`;

export class OpsMetricsRepository extends BaseRepository {
    /** 실패 작업 목록(최신순) — error 첫 줄·goal 앞부분만. */
    async getFailedRuns(hours: number, limit: number, goalChars: number, errorChars: number): Promise<OpsRunRow[]> {
        const r = await this.query<OpsRunRow>(
            `SELECT id, user_id, status, model,
                    LEFT(goal, $3::int) AS goal,
                    LEFT(split_part(COALESCE(error, ''), E'\\n', 1), $4::int) AS error,
                    judge_verdict,
                    ROUND(${DURATION})::text AS duration_s,
                    total_tokens, created_at
             FROM agent_tasks
             WHERE status = 'failed' AND created_at >= ${WINDOW}
             ORDER BY created_at DESC
             LIMIT $2`,
            [String(hours), String(limit), String(goalChars), String(errorChars)],
        );
        return r.rows;
    }

    /** 가장 오래 걸린 작업(완료·실패 포함). */
    async getSlowestRuns(hours: number, limit: number, goalChars: number, errorChars: number): Promise<OpsRunRow[]> {
        const r = await this.query<OpsRunRow>(
            `SELECT id, user_id, status, model,
                    LEFT(goal, $3::int) AS goal,
                    LEFT(split_part(COALESCE(error, ''), E'\\n', 1), $4::int) AS error,
                    judge_verdict,
                    ROUND(${DURATION})::text AS duration_s,
                    total_tokens, created_at
             FROM agent_tasks
             WHERE created_at >= ${WINDOW} AND status IN ('completed', 'failed')
             ORDER BY ${DURATION} DESC NULLS LAST
             LIMIT $2`,
            [String(hours), String(limit), String(goalChars), String(errorChars)],
        );
        return r.rows;
    }

    /** 상태별 건수·평균 소요·평균 토큰 + 목표 미달(goal_incomplete / not_achieved) 건수. */
    async getRunsSummary(hours: number): Promise<OpsRunsSummaryRow[]> {
        const r = await this.query<OpsRunsSummaryRow>(
            `SELECT status, COUNT(*) AS runs,
                    ROUND(AVG(${DURATION}))::text AS avg_duration_s,
                    ROUND(AVG(total_tokens))::text AS avg_tokens,
                    COUNT(*) FILTER (WHERE error = 'goal_incomplete' OR judge_verdict = 'not_achieved') AS goal_incomplete
             FROM agent_tasks
             WHERE created_at >= ${WINDOW}
             GROUP BY status
             ORDER BY runs DESC`,
            [String(hours)],
        );
        return r.rows;
    }

    /** 모델별 작업 수·실패·평균 소요·평균 토큰. */
    async getRunsByModel(hours: number): Promise<OpsRunsByModelRow[]> {
        const r = await this.query<OpsRunsByModelRow>(
            `SELECT model, COUNT(*) AS runs,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                    ROUND(AVG(${DURATION}))::text AS avg_duration_s,
                    ROUND(AVG(total_tokens))::text AS avg_tokens
             FROM agent_tasks
             WHERE created_at >= ${WINDOW} AND status IN ('completed', 'failed')
             GROUP BY model
             ORDER BY runs DESC`,
            [String(hours)],
        );
        return r.rows;
    }

    /** MCP 서버(내장 포함) 단위 호출·오류·p50 — 채팅·작업 양쪽 경로(audit_logs). */
    async getToolCallsByServer(hours: number): Promise<OpsToolServerRow[]> {
        const r = await this.query<OpsToolServerRow>(
            `SELECT details->>'server' AS server,
                    COUNT(*) AS calls,
                    COUNT(*) FILTER (WHERE details->>'isError' = 'true') AS errors,
                    percentile_disc(0.5) WITHIN GROUP (
                        ORDER BY CASE WHEN details->>'durationMs' ~ '^[0-9]+$'
                                      THEN (details->>'durationMs')::bigint END
                    )::text AS p50_duration_ms,
                    MAX(timestamp) FILTER (WHERE details->>'isError' = 'true') AS last_error_at
             FROM audit_logs
             WHERE action = 'mcp_tool_call' AND timestamp >= ${WINDOW}
             GROUP BY details->>'server'
             ORDER BY errors DESC, calls DESC`,
            [String(hours)],
        );
        return r.rows;
    }

    /** 외부 provider 사용량(토큰·비용·오류) — provider×model. */
    async getProviderUsage(hours: number, limit: number): Promise<OpsProviderUsageRow[]> {
        const r = await this.query<OpsProviderUsageRow>(
            `SELECT provider_id, model_id, COUNT(*) AS requests,
                    SUM(input_tokens)::text AS input_tokens,
                    SUM(output_tokens)::text AS output_tokens,
                    SUM(cost_usd_micros)::text AS cost_usd_micros,
                    ROUND(AVG(duration_ms))::text AS avg_duration_ms,
                    COUNT(*) FILTER (WHERE error_code IS NOT NULL) AS errors
             FROM external_provider_usage
             WHERE occurred_at >= ${WINDOW}
             GROUP BY provider_id, model_id
             ORDER BY requests DESC
             LIMIT $2`,
            [String(hours), String(limit)],
        );
        return r.rows;
    }

    /** 에이전트 작업 토큰 상위 사용자. */
    async getTaskTokensByUser(hours: number, limit: number): Promise<OpsTaskTokensByUserRow[]> {
        const r = await this.query<OpsTaskTokensByUserRow>(
            `SELECT user_id, COUNT(*) AS runs, SUM(total_tokens)::text AS total_tokens
             FROM agent_tasks
             WHERE created_at >= ${WINDOW}
             GROUP BY user_id
             ORDER BY SUM(total_tokens) DESC NULLS LAST
             LIMIT $2`,
            [String(hours), String(limit)],
        );
        return r.rows;
    }
}
