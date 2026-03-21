/**
 * ============================================================
 * UIR Routes - Unified Intent Router 모니터링 API
 * ============================================================
 *
 * UIR shadow log 통계, 로그 조회, 롤아웃 설정 관리 엔드포인트.
 * 모든 엔드포인트는 관리자(admin) 전용입니다.
 *
 * @module routes/uir.routes
 * @description
 * - GET  /api/uir/stats    - shadow log 집계 통계 (최근 7일)
 * - GET  /api/uir/log      - shadow log 최근 항목 조회 (limit/offset)
 * - GET  /api/uir/rollout  - 현재 rollout 설정 조회
 * - PUT  /api/uir/rollout  - rollout 설정 변경
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires requireAdmin - 관리자 권한 미들웨어
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { success, badRequest } from '../utils/api-response';
import { requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';

const logger = createLogger('UIRRoutes');
const router = Router();

// 모든 UIR 엔드포인트는 관리자 전용
router.use(requireAuth, requireAdmin);

// ================================================
// 통계 조회
// ================================================

/**
 * GET /api/uir/stats
 * UIR shadow log 집계 통계 조회 (최근 7일)
 * rollout 설정도 함께 반환합니다.
 */
router.get('/stats', asyncHandler(async (_req: Request, res: Response) => {
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const pool = getUnifiedDatabase().getPool();

    const [statsResult, rolloutResult] = await Promise.all([
        pool.query<{
            total_comparisons: number;
            agent_match_count: number;
            qtype_match_count: number;
            profile_match_count: number;
            agent_match_rate: string | null;
            qtype_match_rate: string | null;
            avg_latency_ms: string | null;
            first_comparison: Date | null;
            last_comparison: Date | null;
        }>(`
            SELECT
                COUNT(*)::integer                                        AS total_comparisons,
                COUNT(*) FILTER (WHERE agent_match = true)::integer     AS agent_match_count,
                COUNT(*) FILTER (WHERE query_type_match = true)::integer AS qtype_match_count,
                COUNT(*) FILTER (WHERE profile_match = true)::integer   AS profile_match_count,
                ROUND(
                    COUNT(*) FILTER (WHERE agent_match = true)::numeric
                    / NULLIF(COUNT(*), 0) * 100, 2
                )                                                        AS agent_match_rate,
                ROUND(
                    COUNT(*) FILTER (WHERE query_type_match = true)::numeric
                    / NULLIF(COUNT(*), 0) * 100, 2
                )                                                        AS qtype_match_rate,
                ROUND(AVG(uir_latency_ms), 2)                           AS avg_latency_ms,
                MIN(created_at)                                         AS first_comparison,
                MAX(created_at)                                         AS last_comparison
            FROM uir_shadow_log
            WHERE created_at > NOW() - INTERVAL '7 days'
        `),
        pool.query<{
            rollout_percent: number;
            enabled: boolean;
            description: string | null;
            updated_at: Date;
        }>(`
            SELECT rollout_percent, enabled, description, updated_at
            FROM uir_rollout_config
            ORDER BY id DESC
            LIMIT 1
        `)
    ]);

    const stats = statsResult.rows[0] ?? null;
    const rollout = rolloutResult.rows[0] ?? null;

    logger.info('UIR stats 조회 완료', {
        total: stats?.total_comparisons ?? 0
    });

    res.json(success({ stats, rollout }));
}));

// ================================================
// 로그 조회
// ================================================

/**
 * GET /api/uir/log?limit=50&offset=0
 * UIR shadow log 최근 항목 조회
 */
router.get('/log', asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const pool = getUnifiedDatabase().getPool();

    const result = await pool.query<{
        id: number;
        session_id: string;
        uir_query_type: string;
        uir_agent_id: string;
        uir_brand_profile: string;
        uir_complexity: string | null;
        uir_confidence: number | null;
        uir_latency_ms: number | null;
        legacy_query_type: string;
        legacy_agent_id: string;
        legacy_brand_profile: string;
        agent_match: boolean;
        query_type_match: boolean;
        profile_match: boolean;
        created_at: Date;
    }>(`
        SELECT
            id, session_id, uir_query_type, uir_agent_id, uir_brand_profile,
            uir_complexity, uir_confidence, uir_latency_ms,
            legacy_query_type, legacy_agent_id, legacy_brand_profile,
            agent_match, query_type_match, profile_match,
            created_at
        FROM uir_shadow_log
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json(success({
        items: result.rows,
        limit,
        offset,
        count: result.rows.length
    }));
}));

// ================================================
// 롤아웃 설정
// ================================================

/**
 * GET /api/uir/rollout
 * 현재 rollout 설정 조회
 */
router.get('/rollout', asyncHandler(async (_req: Request, res: Response) => {
    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const pool = getUnifiedDatabase().getPool();

    const result = await pool.query<{
        id: number;
        rollout_percent: number;
        enabled: boolean;
        description: string | null;
        updated_at: Date;
    }>(`
        SELECT id, rollout_percent, enabled, description, updated_at
        FROM uir_rollout_config
        ORDER BY id DESC
        LIMIT 1
    `);

    const rollout = result.rows[0] ?? null;

    res.json(success({ rollout }));
}));

/**
 * PUT /api/uir/rollout
 * rollout 설정 변경
 * Body: { rollout_percent: number, enabled: boolean, description?: string }
 */
router.put('/rollout', asyncHandler(async (req: Request, res: Response) => {
    const { rollout_percent, enabled, description } = req.body as {
        rollout_percent: unknown;
        enabled: unknown;
        description?: unknown;
    };

    // 유효성 검증
    if (typeof rollout_percent !== 'number' || rollout_percent < 0 || rollout_percent > 100) {
        return res.status(400).json(badRequest(
            'rollout_percent는 0 이상 100 이하의 숫자여야 합니다.'
        ));
    }

    if (typeof enabled !== 'boolean') {
        return res.status(400).json(badRequest(
            'enabled는 boolean 값이어야 합니다.'
        ));
    }

    const descValue = typeof description === 'string' ? description : null;

    const { getUnifiedDatabase } = await import('../data/models/unified-database');
    const pool = getUnifiedDatabase().getPool();

    const result = await pool.query<{
        id: number;
        rollout_percent: number;
        enabled: boolean;
        description: string | null;
        updated_at: Date;
    }>(`
        INSERT INTO uir_rollout_config (rollout_percent, enabled, description)
        VALUES ($1, $2, $3)
        RETURNING id, rollout_percent, enabled, description, updated_at
    `, [rollout_percent, enabled, descValue]);

    const rollout = result.rows[0];

    logger.info('UIR rollout 설정 변경', {
        rollout_percent,
        enabled,
        description: descValue
    });

    res.json(success({ rollout }));
}));

export default router;
export { router as uirRouter };
