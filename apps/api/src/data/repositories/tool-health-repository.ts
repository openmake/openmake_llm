/**
 * @module data/repositories/tool-health-repository
 * @description 도구별 실행 건전성(호출·실패·실패율·원인) 읽기 전용 집계 계층
 *
 * 소스는 `audit_logs(action='mcp_tool_call')` — `unified-client.auditToolCall` 이 채팅·에이전트
 * 작업 **양쪽** 경로에서 남기므로, 에이전트 작업만 보는 `agent-task-metrics-repository` 와 달리
 * 전 경로를 덮는다. 그리고 성공 호출도 행으로 남으므로 **분모(호출 수)** 가 있다 —
 * 기존 도구 오류 지표는 오류 건수 top N 뿐이라 "6번 호출해 5번 실패한 도구" 가 보이지 않았다.
 *
 * ⚠️ 감사 기록은 fire-and-forget(`void`)이라 유실될 수 있다 — 이 집계는 하한이다.
 * ⚠️ `errorCategory` 는 2026-08-28 이후 호출에만 있다(그 이전 실패는 카테고리 미상).
 *
 * 전부 파라미터화 쿼리, read-only. 숫자 파싱(COUNT 는 문자열로 옴)은 응답 조립부에 남긴다.
 */
import { BaseRepository } from './base-repository';

/** 도구 단위 집계 행 — 분모(calls) 포함이 이 지표의 존재 이유. */
export interface ToolHealthRow {
    tool: string;
    server: string | null;
    calls: string;
    errors: string;
    last_error_at: Date | null;
    p50_duration_ms: string | null;
}

/** 도구 × 실패 카테고리 건수 — 원인별 분해(도구가 고장인지 모델이 틀린 것인지). */
export interface ToolErrorCategoryRow {
    tool: string;
    category: string | null;
    count: string;
}

/** 기간 전체 요약 — 도구 단위 목록의 상단 타일. */
export interface ToolHealthSummaryRow {
    calls: string;
    errors: string;
    distinct_tools: string;
    failing_tools: string;
}

export class ToolHealthRepository extends BaseRepository {
    /**
     * 도구별 호출/실패/실패율 재료. `minCalls` 미만 표본은 제외한다 —
     * 1회 호출 1회 실패가 100% 로 상위를 차지하면 목록이 쓸모없어진다.
     * 정렬은 실패율 desc, 동률이면 호출 수 desc.
     */
    async getToolHealth(days: number, minCalls: number, limit: number): Promise<ToolHealthRow[]> {
        const result = await this.query<ToolHealthRow>(
            `SELECT resource_id AS tool,
                    MAX(details->>'server') AS server,
                    COUNT(*) AS calls,
                    COUNT(*) FILTER (WHERE details->>'isError' = 'true') AS errors,
                    MAX(timestamp) FILTER (WHERE details->>'isError' = 'true') AS last_error_at,
                    percentile_disc(0.5) WITHIN GROUP (
                        ORDER BY CASE WHEN details->>'durationMs' ~ '^[0-9]+$'
                                      THEN (details->>'durationMs')::bigint END
                    ) AS p50_duration_ms
             FROM audit_logs
             WHERE action = 'mcp_tool_call'
               AND resource_id IS NOT NULL
               AND timestamp >= NOW() - ($1 || ' days')::interval
             GROUP BY resource_id
             HAVING COUNT(*) >= $2
             ORDER BY (COUNT(*) FILTER (WHERE details->>'isError' = 'true'))::numeric / COUNT(*) DESC,
                      COUNT(*) DESC,
                      resource_id
             LIMIT $3`,
            [String(days), String(minCalls), String(limit)]
        );
        return result.rows;
    }

    /** 도구 × 카테고리 실패 건수 (카테고리 미기록 실패는 category=null 로 묶임). */
    async getErrorCategories(days: number): Promise<ToolErrorCategoryRow[]> {
        const result = await this.query<ToolErrorCategoryRow>(
            `SELECT resource_id AS tool,
                    details->>'errorCategory' AS category,
                    COUNT(*) AS count
             FROM audit_logs
             WHERE action = 'mcp_tool_call'
               AND resource_id IS NOT NULL
               AND details->>'isError' = 'true'
               AND timestamp >= NOW() - ($1 || ' days')::interval
             GROUP BY resource_id, details->>'errorCategory'`,
            [String(days)]
        );
        return result.rows;
    }

    /** 기간 요약 — 총 호출·총 실패·도구 수·실패가 1건이라도 있는 도구 수. */
    async getSummary(days: number): Promise<ToolHealthSummaryRow> {
        const result = await this.query<ToolHealthSummaryRow>(
            `SELECT COUNT(*) AS calls,
                    COUNT(*) FILTER (WHERE details->>'isError' = 'true') AS errors,
                    COUNT(DISTINCT resource_id) AS distinct_tools,
                    COUNT(DISTINCT resource_id) FILTER (WHERE details->>'isError' = 'true') AS failing_tools
             FROM audit_logs
             WHERE action = 'mcp_tool_call'
               AND resource_id IS NOT NULL
               AND timestamp >= NOW() - ($1 || ' days')::interval`,
            [String(days)]
        );
        return result.rows[0] ?? { calls: '0', errors: '0', distinct_tools: '0', failing_tools: '0' };
    }
}
