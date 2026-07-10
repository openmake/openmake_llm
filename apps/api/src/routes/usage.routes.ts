/**
 * ============================================================
 * Usage Routes - API 사용량 통계 라우트
 * ============================================================
 *
 * 인증된 사용자를 대상으로 API 사용량 요약 및 일간 통계를 제공합니다.
 * ApiUsageTracker의 영구 저장된 통계를 기반으로 응답합니다.
 *
 * @module routes/usage.routes
 * @description
 * - GET /api/usage       - API 사용량 통계 요약 (인증)
 * - GET /api/usage/daily - 일간 사용량 조회 (인증, 쿼리: ?days=7)
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires ApiUsageTracker - API 사용량 추적기
 */

import { Router, Request, Response } from 'express';
import { getApiUsageTracker } from '../llm';
import { success } from '../utils/api-response';
import { requireAuth } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { getPool } from '../data/models/unified-database';

const router = Router();

// API 사용량 조회에 인증 필수
router.use(requireAuth);

/** req.user 에서 user id 추출 (requireAuth 통과 이후). */
function getUserId(req: Request): string | null {
    if (!req.user) return null;
    if ('userId' in req.user && typeof (req.user as { userId?: unknown }).userId === 'string') {
        return (req.user as { userId: string }).userId;
    }
    if ('id' in req.user) {
        return String(req.user.id);
    }
    return null;
}

/** days 쿼리 파라미터 정수 파싱 + clamp(1~365). interval 인젝션 방지. */
function parseDays(raw: unknown, fallback = 7): number {
    const n = parseInt(String(raw ?? ''), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(365, Math.max(1, n));
}

/**
 * API 사용량 통계 요약 조회
 * GET /api/usage
 */
router.get('/', asyncHandler(async (req: Request, res: Response) => {
    const tracker = getApiUsageTracker();
    const summary = tracker.getSummary();
    const uptime = Math.round(process.uptime());

    // usage-tracker 는 modelUsage/totalRequests 를 미추적(하드코딩 {}/0)이라 사용량 페이지의
    // "모델별 사용 비중"·"요청 수"가 비어있었다. 페이지는 allTime.modelUsage/totalRequests 를
    // 읽으므로(내 계정 기준), 본인 전체 대화(conversation_messages, 일별 차트와 동일 소스)에서
    // 모델별 토큰 + 요청 수(assistant 메시지 수)를 집계해 채운다.
    const userId = getUserId(req);
    let modelUsage: Record<string, number> = {};
    let totalRequests = 0;
    let enriched = false;
    if (userId) {
        try {
            const r = await getPool().query(
                `SELECT COALESCE(m.model, 'default') AS model,
                        COALESCE(SUM(m.tokens), 0) AS tokens,
                        COUNT(*) FILTER (WHERE m.role = 'assistant') AS requests
                 FROM conversation_messages m
                 JOIN conversation_sessions s ON m.session_id = s.id
                 WHERE s.user_id = $1
                 GROUP BY 1`,
                [userId],
            );
            for (const row of r.rows as Array<{ model: string; tokens: string; requests: string }>) {
                if (Number(row.tokens) > 0) modelUsage[row.model] = Number(row.tokens);
                totalRequests += Number(row.requests);
            }
            enriched = true;
        } catch { /* 집계 실패 시 tracker 기본값 유지 */ modelUsage = {}; }
    }

    // allTime 타입엔 modelUsage 가 없어 인라인 조립으로 병합(프론트는 allTime.modelUsage/totalRequests 소비).
    res.json(success({
        ...summary,
        ...(enriched
            ? {
                today: { ...summary.today, modelUsage, totalRequests },
                allTime: { ...summary.allTime, modelUsage, totalRequests },
            }
            : {}),
        uptime,
    }));
}));

/**
 * 본인 일별 토큰/메시지 통계 조회 — conversation_messages 를 본인 세션으로 JOIN 집계
 * GET /api/usage/daily?days=7
 *
 * (구 usage-tracker.getDailyStats() stub 은 vLLM 마이그레이션 후 빈 배열만 반환했으므로
 *  conversation_messages 기반 raw SQL 집계로 교체.)
 */
router.get('/daily', asyncHandler(async (req: Request, res: Response) => {
    const userId = getUserId(req);
    if (!userId) {
        res.json(success({ daily: [] }));
        return;
    }
    const days = parseDays(req.query.days);
    const r = await getPool().query(
        `SELECT to_char(date_trunc('day', m.created_at), 'YYYY-MM-DD') AS date,
                COALESCE(SUM(m.tokens), 0) AS tokens,
                COUNT(*) AS messages
         FROM conversation_messages m
         JOIN conversation_sessions s ON m.session_id = s.id
         WHERE s.user_id = $1
           AND m.created_at >= NOW() - ($2 || ' days')::interval
         GROUP BY 1
         ORDER BY 1`,
        [userId, String(days)]
    );
    const daily = r.rows.map((row: { date: string; tokens: string; messages: string }) => ({
        date: row.date,
        tokens: Number(row.tokens),
        messages: Number(row.messages),
    }));
    res.json(success({ daily }));
}));

export default router;
