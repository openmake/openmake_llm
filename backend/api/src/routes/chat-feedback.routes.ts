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
import { createLogger } from '../utils/logger';

const router = Router();
const logger = createLogger('ChatFeedbackRoutes');


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
        await repo.recordFeedback({
            messageId,
            sessionId,
            userId: feedbackUserId,
            signal,
            routingMetadata: safeMetadata,
        });

        // 피드백 → 장기 메모리에 컨텍스트 기록 (fire-and-forget, 응답 지연 없음)
        if (feedbackUserId && safeMetadata) {
            (async () => {
                const { getMemoryService } = await import('../services/MemoryService');
                const memoryService = getMemoryService();
                const feedbackInfo = [
                    safeMetadata.model && `model=${safeMetadata.model}`,
                    safeMetadata.queryType && `type=${safeMetadata.queryType}`,
                    safeMetadata.profileId && `profile=${safeMetadata.profileId}`,
                ].filter(Boolean).join(', ');

                if (signal === 'thumbs_down') {
                    await memoryService.saveMemory(feedbackUserId, sessionId || null, {
                        category: 'context',
                        key: '부정 피드백 패턴',
                        value: `불만족 응답 (${feedbackInfo})`,
                        importance: 0.4,
                        tags: ['feedback', 'negative'],
                    });
                } else if (signal === 'thumbs_up') {
                    await memoryService.saveMemory(feedbackUserId, sessionId || null, {
                        category: 'context',
                        key: '긍정 피드백 패턴',
                        value: `만족 응답 (${feedbackInfo})`,
                        importance: 0.3,
                        tags: ['feedback', 'positive'],
                    });
                } else if (signal === 'regenerate') {
                    await memoryService.saveMemory(feedbackUserId, sessionId || null, {
                        category: 'context',
                        key: '재생성 요청 패턴',
                        value: `응답 재생성 요청 (${feedbackInfo})`,
                        importance: 0.35,
                        tags: ['feedback', 'regenerate'],
                    });
                }
            })().catch(e => logger.debug('피드백 메모리 저장 실패 (무시):', e));
        }

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
