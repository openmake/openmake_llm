/**
 * @module mcp/ops-metrics-tool
 * @description 운영 지표 읽기 전용 내장 도구 `ops_metrics` (2026-09-07, Phase 1)
 *
 * 관리자가 채팅에서 "지난 24시간 실패한 작업", "Playwright 오류 늘었어?" 처럼 물으면 모델이
 * 운영 DB 집계를 근거로 답하게 한다. 자유 SQL 은 받지 않고 **명명 질의 enum + 기간 창 + limit**
 * 만 받는다. 데이터 소스·근거는 `config/ops-metrics.ts` 참고.
 *
 * 역할: 노출·실행 게이트는 `BUILTIN_TOOL_REQUIRED_ROLE`(tool-role-gate) 가 맡고, 여기서는
 * 핸들러 안에서 한 번 더 확인한다(기존 ingest 도구와 같은 심층 방어).
 */
import { MCPToolDefinition, MCPToolResult } from './types';
import { isAdminRole } from '../data/user-manager';
import {
    OPS_METRICS_LIMITS, OPS_METRICS_TOOL_ENABLED, OPS_METRICS_WINDOWS,
} from '../config/ops-metrics';
import { TOOL_HEALTH_QUERY } from '../config/tool-health';

export const OPS_METRICS_QUERIES = [
    'summary', 'failed_runs', 'slowest_runs', 'runs_by_model',
    'tool_errors', 'token_usage', 'goal_incomplete',
] as const;
export type OpsMetricsQuery = (typeof OPS_METRICS_QUERIES)[number];

interface OpsMetricsArgs extends Record<string, unknown> {
    query?: string;
    window?: string;
    limit?: number;
}

function textResult(text: string, isError = false): MCPToolResult {
    return { content: [{ type: 'text', text }], isError };
}

function resolveWindowHours(window: unknown): { key: string; hours: number } | null {
    const key = typeof window === 'string' && window ? window : OPS_METRICS_LIMITS.DEFAULT_WINDOW;
    const hours = OPS_METRICS_WINDOWS[key];
    return hours ? { key, hours } : null;
}

function resolveLimit(limit: unknown): number {
    const n = Number(limit);
    if (!Number.isFinite(n) || n <= 0) return OPS_METRICS_LIMITS.DEFAULT_LIMIT;
    return Math.min(Math.floor(n), OPS_METRICS_LIMITS.MAX_LIMIT);
}

/**
 * 질의 실행 — 저장소는 지연 import(부팅 시 DB 결합 회피, 기존 ingest 도구 패턴).
 * 도구 단위 건전성·판정 분포·실패 사유는 기존 저장소를 재사용한다.
 */
export async function runOpsMetricsQuery(query: OpsMetricsQuery, hours: number, limit: number): Promise<unknown> {
    const { getPool } = await import('../data/models/unified-database');
    const { OpsMetricsRepository } = await import('../data/repositories/ops-metrics-repository');
    const pool = getPool();
    const ops = new OpsMetricsRepository(pool);
    const { GOAL_SNIPPET_CHARS, ERROR_SNIPPET_CHARS } = OPS_METRICS_LIMITS;
    const days = hours / 24;

    switch (query) {
        case 'summary': {
            const [runs, servers] = await Promise.all([ops.getRunsSummary(hours), ops.getToolCallsByServer(hours)]);
            return { runs, tool_calls_by_server: servers };
        }
        case 'failed_runs':
            return { runs: await ops.getFailedRuns(hours, limit, GOAL_SNIPPET_CHARS, ERROR_SNIPPET_CHARS) };
        case 'slowest_runs':
            return { runs: await ops.getSlowestRuns(hours, limit, GOAL_SNIPPET_CHARS, ERROR_SNIPPET_CHARS) };
        case 'runs_by_model':
            return { models: await ops.getRunsByModel(hours) };
        case 'tool_errors': {
            const { ToolHealthRepository } = await import('../data/repositories/tool-health-repository');
            const th = new ToolHealthRepository(pool);
            const [servers, tools, categories] = await Promise.all([
                ops.getToolCallsByServer(hours),
                th.getToolHealth(days, TOOL_HEALTH_QUERY.DEFAULT_MIN_CALLS, limit),
                th.getErrorCategories(days),
            ]);
            return { by_server: servers, failing_tools: tools, error_categories: categories };
        }
        case 'token_usage': {
            const [byUser, providers] = await Promise.all([
                ops.getTaskTokensByUser(hours, limit), ops.getProviderUsage(hours, limit),
            ]);
            return { agent_task_tokens_by_user: byUser, external_provider_usage: providers };
        }
        case 'goal_incomplete': {
            const { AgentTaskMetricsRepository } = await import('../data/repositories/agent-task-metrics-repository');
            const atm = new AgentTaskMetricsRepository(pool);
            const [verdicts, reasons, summary] = await Promise.all([
                atm.getCompletionVerdictDistribution(days), atm.getFailureReasons(days, limit), ops.getRunsSummary(hours),
            ]);
            return { completion_verdicts: verdicts, failure_reasons: reasons, runs: summary };
        }
        default: {
            const never: never = query;
            throw new Error(`unknown query ${String(never)}`);
        }
    }
}

export const opsMetricsTool: MCPToolDefinition<OpsMetricsArgs> = {
    tool: {
        name: 'ops_metrics',
        description:
            '[관리자 전용] 이 배포의 운영 지표를 DB 에서 집계해 돌려줍니다 — 에이전트 작업 실패/느린 작업/모델별, ' +
            'MCP·내장 도구 호출·오류율(서버·도구·원인 카테고리), 토큰·외부 provider 사용량·비용, 목표 미달(goal judge) 분포. ' +
            '"지난 24시간 실패한 작업", "Playwright 오류 많아?", "이번 주 토큰 많이 쓴 작업" 같은 운영 질문에 이 도구 결과를 근거로 답하세요. ' +
            '읽기 전용이며 자유 SQL 은 받지 않습니다. 숫자 필드는 문자열로 올 수 있습니다.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    enum: [...OPS_METRICS_QUERIES],
                    description: 'summary=상태별 작업 요약+서버별 도구 호출 · failed_runs=실패 작업 목록 · slowest_runs=오래 걸린 작업 · '
                        + 'runs_by_model=모델별 작업 · tool_errors=서버/도구/원인별 오류 · token_usage=토큰·비용 · goal_incomplete=목표 미달 판정 분포·실패 사유',
                },
                window: {
                    type: 'string',
                    enum: Object.keys(OPS_METRICS_WINDOWS),
                    description: `집계 기간 (기본 ${OPS_METRICS_LIMITS.DEFAULT_WINDOW})`,
                },
                limit: { type: 'number', description: `목록 최대 행 수 (기본 ${OPS_METRICS_LIMITS.DEFAULT_LIMIT}, 최대 ${OPS_METRICS_LIMITS.MAX_LIMIT})` },
            },
            required: ['query'],
        },
    },
    handler: async (args, context): Promise<MCPToolResult> => {
        if (!OPS_METRICS_TOOL_ENABLED) return textResult('ops_metrics 도구가 비활성화되어 있습니다(OPS_METRICS_TOOL_ENABLED=false).', true);
        if (!context?.userId || !isAdminRole(context.role)) {
            return textResult('ops_metrics 는 관리자 전용 도구입니다.', true);
        }
        const query = String(args.query ?? '') as OpsMetricsQuery;
        if (!OPS_METRICS_QUERIES.includes(query)) {
            return textResult(`알 수 없는 query: ${query} — 가능한 값: ${OPS_METRICS_QUERIES.join(', ')}`, true);
        }
        const win = resolveWindowHours(args.window);
        if (!win) return textResult(`알 수 없는 window: ${String(args.window)} — 가능한 값: ${Object.keys(OPS_METRICS_WINDOWS).join(', ')}`, true);
        const limit = resolveLimit(args.limit);
        try {
            const data = await runOpsMetricsQuery(query, win.hours, limit);
            return textResult(JSON.stringify({ query, window: win.key, limit, generated_at: new Date().toISOString(), data }));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return textResult(`운영 지표 조회 실패 (${query}): ${message}`, true);
        }
    },
};
