/**
 * 도구 헬스 관측 라우트 (admin 전용).
 *
 * 엔드포인트:
 *   GET  /api/metrics/tools/health?days=N&minCalls=N&limit=N
 *     — 도구별 호출·실패·**실패율**·주 실패 카테고리·p50 소요·마지막 실패 시각.
 *   GET  /api/metrics/tools/circuit        — 서킷 현재 상태(인메모리 스냅샷) + 설정.
 *   POST /api/metrics/tools/circuit/reset  — 서킷 수동 해제(오탐 즉시 되돌리기).
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
import { TOOL_HEALTH_QUERY, TOOL_CIRCUIT } from '../config/tool-health';
import { getCircuitSnapshot, resetToolCircuit } from '../mcp/tool-health';
import { getAuditService } from '../services/AuditService';
import { badRequest, notFound } from '../utils/api-response';
import { createLogger } from '../utils/logger';

const logger = createLogger('ToolHealthRoutes');

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

/**
 * 서킷 현재 상태. 인메모리라 프로세스 재시작 시 비어 있는 것이 정상이다
 * (재시작 리셋이 "서버를 고쳤는데 여전히 차단"보다 안전하다는 설계).
 */
toolHealthRouter.get('/circuit', asyncHandler(async (_req: Request, res: Response) => {
    res.json(success({
        config: {
            enabled: TOOL_CIRCUIT.ENABLED,
            scope: TOOL_CIRCUIT.SCOPE,
            failureThreshold: TOOL_CIRCUIT.FAILURE_THRESHOLD,
            windowMs: TOOL_CIRCUIT.WINDOW_MS,
            minCalls: TOOL_CIRCUIT.MIN_CALLS,
            openMs: TOOL_CIRCUIT.OPEN_MS,
            excludedCategories: TOOL_CIRCUIT.EXCLUDED_CATEGORIES,
        },
        circuits: getCircuitSnapshot(),
    }));
}));

/**
 * 서킷 수동 해제. 오탐 차단을 즉시 되돌릴 수단 없이는 이 기능을 켤 수 없다.
 * 도구 이름에 `::` 가 들어가므로 path param 대신 body 로 받는다.
 */
toolHealthRouter.post('/circuit/reset', asyncHandler(async (req: Request, res: Response) => {
    const tool = typeof req.body?.tool === 'string' ? req.body.tool.trim() : '';
    if (!tool) {
        res.status(400).json(badRequest('tool 이 필요합니다.'));
        return;
    }
    const cleared = resetToolCircuit(tool);
    if (!cleared) {
        res.status(404).json(notFound(`추적 중인 서킷(${tool})`));
        return;
    }
    try {
        await getAuditService().logAudit({
            action: 'tool_circuit_reset',
            userId: (req as Request & { user?: { id?: string } }).user?.id,
            resourceType: 'tool_circuit',
            resourceId: tool,
        });
    } catch (e) {
        // 감사 실패가 해제를 되돌리진 않는다 — 애플리케이션 로그로 복원 가능하게 남긴다.
        logger.warn(`서킷 해제 감사 기록 실패(무시): ${tool} — ${e instanceof Error ? e.message : e}`);
    }
    res.json(success({ tool, reset: true }));
}));

export default toolHealthRouter;
