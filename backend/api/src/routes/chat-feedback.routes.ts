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
                a2aMode?: string;
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
        const repo = new FeedbackRepository(getPool());
        await repo.recordFeedback({
            messageId,
            sessionId,
            userId: req.user ? String((req.user as { userId?: string; id?: string | number }).userId ?? (req.user as { id?: string | number }).id ?? '') || undefined : undefined,
            signal,
            routingMetadata: safeMetadata,
        });
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

export default router;
