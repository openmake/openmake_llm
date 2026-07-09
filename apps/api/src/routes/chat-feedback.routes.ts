/**
 * ============================================================
 * Chat Feedback Routes - 사용자 피드백 수집 API
 * ============================================================
 *
 * 메시지별 thumbs_up / thumbs_down / regenerate 신호를 수집하고
 * 관리자용 집계 통계를 제공합니다.
 *
 * @module routes/chat-feedback.routes
 * @description
 * - POST /api/chat/feedback       — 피드백 기록 (optionalAuth)
 * - GET  /api/chat/feedback/stats — 집계 통계 (requireAuth + requireAdmin)
 */

import { Router, Request, Response } from 'express';
import { optionalAuth, requireAuth, requireAdmin } from '../auth';
import { asyncHandler } from '../utils/error-handler';
import { success, badRequest } from '../utils/api-response';
import { FeedbackRepository } from '../data/repositories/feedback-repository';
import { getPool } from '../data/models/unified-database';
import { validate } from '../middlewares/validation';
import { chatFeedbackSchema } from '../schemas/chat-feedback.schema';
const router = Router();


/**
 * POST /api/chat/feedback
 * 메시지 피드백을 기록합니다.
 * Auth: optionalAuth — 비로그인 사용자도 피드백 가능
 */
router.post(
    '/',
    optionalAuth,
    validate(chatFeedbackSchema),
    asyncHandler(async (req: Request, res: Response) => {
        const { messageId, sessionId, signal, routingMetadata } = req.body as {
            messageId: string;
            sessionId: string;
            signal: 'thumbs_up' | 'thumbs_down' | 'regenerate';
            routingMetadata?: {
                model?: string;
                queryType?: string;
                latencyMs?: number;
                profileId?: string;
            };
        };
        const safeMetadata =
            routingMetadata !== null &&
            routingMetadata !== undefined &&
            typeof routingMetadata === 'object' &&
            !Array.isArray(routingMetadata)
                ? routingMetadata
                : undefined;
        const feedbackUserId = req.user ? String((req.user as { userId?: string; id?: string | number }).userId ?? (req.user as { id?: string | number }).id ?? '') || undefined : undefined;
        const repo = new FeedbackRepository(getPool());
        try {
            await repo.recordFeedback({
                messageId,
                sessionId,
                userId: feedbackUserId,
                signal,
                routingMetadata: safeMetadata,
            });
        } catch (err) {
            // 세션/메시지 미영속(예: saveHistory=false)이면 FK 위반(23503) — 사용자의 피드백
            // 클릭이 500 으로 깨지지 않도록 graceful no-op 처리(신호는 저장 불가하나 UX 보존).
            const code = (err as { code?: string })?.code;
            if (code === '23503') {
                res.json(success({ recorded: false, reason: 'session_not_persisted' }));
                return;
            }
            throw err;
        }

        // Phase B Phase 2-A (2026-05-26): 피드백 기반 분류 캐시 교정 제거.
        // LLM classifier 와 함께 feedback-cache-corrector 삭제됨.
        // 피드백 신호 자체는 DB (FeedbackRepository.recordFeedback) 에 보존.

        res.json(success({ recorded: true }));
    })
);

/**
 * GET /api/chat/feedback/stats
 * 피드백 집계 통계를 반환합니다.
 * Auth: requireAuth + requireAdmin
 * Query: ?days=30 (기본값 30)
 */
router.get(
    '/stats',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const rawDays = req.query['days'];
        const days = rawDays !== undefined ? parseInt(String(rawDays), 10) : 30;

        if (isNaN(days) || days < 1 || days > 365) {
            res.status(400).json(badRequest('days는 1~365 사이의 정수여야 합니다'));
            return;
        }

        const repo = new FeedbackRepository(getPool());
        const stats = await repo.getFeedbackStats(days);

        res.json(success(stats));
    })
);

/**
 * GET /api/chat/feedback/stats/routing
 * 라우팅 품질 통계를 반환합니다 (분류 출처별 피드백 분포 + 토큰 예산 효율성).
 * Auth: requireAuth + requireAdmin
 * Query: ?days=30 (기본값 30)
 */
router.get(
    '/stats/routing',
    requireAuth,
    requireAdmin,
    asyncHandler(async (req: Request, res: Response) => {
        const rawDays = req.query['days'];
        const days = rawDays !== undefined ? parseInt(String(rawDays), 10) : 30;

        if (isNaN(days) || days < 1 || days > 365) {
            res.status(400).json(badRequest('days는 1~365 사이의 정수여야 합니다'));
            return;
        }

        const repo = new FeedbackRepository(getPool());
        const [bySource, tokenEfficiency, gvStats] = await Promise.all([
            repo.getFeedbackByClassifierSource(days),
            repo.getTokenBudgetEfficiency(days),
            repo.getGvVerificationStats(days),
        ]);

        res.json(success({ bySource, tokenEfficiency, gvStats }));
    })
);

export default router;
