/**
 * 도구 헬스 관측 라우트 (admin 전용).
 *
 * 엔드포인트:
 *   GET /api/metrics/tools/health?days=N&minCalls=N&limit=N
 *     — 도구별 호출·실패·**실패율**·주 실패 카테고리·p50 소요·마지막 실패 시각.
 *
 * 기존 `GET /api/metrics/agent-tasks/tool-errors` 와의 차이(둘 다 유지):
 *   ① 소스가 `audit_logs` 라 채팅·에이전트 작업 **양쪽** 경로를 덮는다(그쪽은 작업 스텝만).
 *   ② 성공 호출도 세므로 **분모가 있다** — 저빈도·고실패 도구가 드러난다.
 *   ③ 실패 원인이 문자열 시그니처가 아니라 분류 카테고리다.
 *
 * `metrics.routes.ts` 에 합치지 않은 이유: 그 파일이 517줄로 600줄 가드에 근접했고,
 * 서킷 상태 조회·리셋(후속)이 같은 축으로 더 붙는다.
 *
 * @module routes/tool-health.routes
 */
import { Router, type Request, type Response } from 'express';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success } from '../utils/api-response';
import { getPool } from '../data/models/unified-database';
import { ToolHealthRepository } from '../data/repositories/tool-health-repository';
import { TOOL_HEALTH_QUERY } from '../config/tool-health';

export const toolHealthRouter = Router();
toolHealthRouter.use(requireAuth, requireAdmin);

/** 정수 쿼리 파라미터 파싱 — 범위를 벗어나면 기본값이 아니라 경계로 클램프. */
function parseIntParam(raw: unknown, fallback: number, min: number, max: number): number {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(n, min), max);
}

toolHealthRouter.get('/health', asyncHandler(async (req: Request, res: Response) => {
    const days = parseIntParam(req.query.days, TOOL_HEALTH_QUERY.DEFAULT_DAYS, 1, TOOL_HEALTH_QUERY.MAX_DAYS);
    const minCalls = parseIntParam(req.query.minCalls, TOOL_HEALTH_QUERY.DEFAULT_MIN_CALLS, 1, TOOL_HEALTH_QUERY.MAX_MIN_CALLS);
    const limit = parseIntParam(req.query.limit, TOOL_HEALTH_QUERY.DEFAULT_LIMIT, 1, TOOL_HEALTH_QUERY.MAX_LIMIT);

    const repo = new ToolHealthRepository(getPool());
    const [rows, categoryRows, summaryRow] = await Promise.all([
        repo.getToolHealth(days, minCalls, limit),
        repo.getErrorCategories(days),
        repo.getSummary(days),
    ]);

    // 도구 → {카테고리: 건수}. 카테고리 미기록(2026-08-28 이전 실패)은 'unknown' 으로 묶는다 —
    // 키를 비우면 프론트에서 "원인 없음" 과 구분되지 않는다.
    const byCategory = new Map<string, Record<string, number>>();
    for (const r of categoryRows) {
        const bucket = byCategory.get(r.tool) ?? {};
        bucket[r.category ?? 'unknown'] = Number(r.count);
        byCategory.set(r.tool, bucket);
    }

    const calls = Number(summaryRow.calls);
    const errors = Number(summaryRow.errors);

    res.json(success({
        days,
        minCalls,
        summary: {
            calls,
            errors,
            errorRate: calls > 0 ? errors / calls : 0,
            distinctTools: Number(summaryRow.distinct_tools),
            failingTools: Number(summaryRow.failing_tools),
        },
        tools: rows.map((r) => {
            const toolCalls = Number(r.calls);
            const toolErrors = Number(r.errors);
            return {
                tool: r.tool,
                server: r.server ?? null,
                calls: toolCalls,
                errors: toolErrors,
                errorRate: toolCalls > 0 ? toolErrors / toolCalls : 0,
                p50DurationMs: r.p50_duration_ms === null ? null : Number(r.p50_duration_ms),
                lastErrorAt: r.last_error_at ? new Date(r.last_error_at).toISOString() : null,
                byCategory: byCategory.get(r.tool) ?? {},
            };
        }),
    }));
}));

export default toolHealthRouter;
