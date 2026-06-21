/**
 * ============================================================
 * Debug Queue Routes — 사용자 메시지 신고 (B+ Phase B5)
 * ============================================================
 *
 * 사용자가 채팅 UI 의 🚩 버튼으로 응답에 문제를 신고할 때, 해당 메시지
 * 페어를 conversation_debug_queue 에 7일 보관한다. 운영자가 디버깅·QA 에
 * 활용 가능.
 *
 * @module routes/debug-queue.routes
 * @see db/migrations/015_conversation_debug_queue.sql
 * @see data/conversation-debug-queue.ts
 */

import { Router, Request, Response } from 'express';
import { success, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth } from '../auth';
import { enqueueDebugCapture, DEBUG_QUEUE_TTL_MS } from '../data/conversation-debug-queue';
import { createLogger } from '../utils/logger';

const logger = createLogger('DebugQueueRoutes');
const router = Router();

/**
 * POST /api/debug-queue/report
 *
 * 사용자가 응답을 신고하면 해당 메시지 페어를 7일 임시 보관.
 *
 * Body:
 *   - sessionId: string (필수)
 *   - userMessage: string (필수)
 *   - assistantMessage: string (필수, 빈 문자열 허용)
 *   - reason: string (선택, 운영자 노트용)
 */
router.post(
    '/report',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const u = req.user;
        const userId = u && 'userId' in u ? u.userId : (u && 'id' in u ? String(u.id) : null);
        if (!userId) {
            res.status(401).json(badRequest('인증된 사용자만 신고할 수 있습니다'));
            return;
        }

        const { sessionId, userMessage, assistantMessage, reason } = req.body ?? {};

        if (typeof sessionId !== 'string' || sessionId.length < 10) {
            res.status(400).json(badRequest('유효한 sessionId 가 필요합니다'));
            return;
        }
        if (typeof userMessage !== 'string' || userMessage.length === 0) {
            res.status(400).json(badRequest('userMessage 는 비어 있지 않은 문자열이어야 합니다'));
            return;
        }
        if (typeof assistantMessage !== 'string') {
            res.status(400).json(badRequest('assistantMessage 는 문자열이어야 합니다 (빈 문자열 허용)'));
            return;
        }

        const capture = await enqueueDebugCapture({
            sessionId,
            userId,
            reason: 'user-report',
            userMessage,
            assistantMessage,
            routingMetadata: typeof reason === 'string' && reason.length > 0
                ? { userReportReason: reason.slice(0, 500) }  // 운영자 노트 — 길이 제한
                : undefined,
        });

        if (!capture) {
            res.status(500).json(badRequest('신고 저장에 실패했습니다. 잠시 후 다시 시도해주세요.'));
            return;
        }

        logger.info(`[Report] user=${userId} session=${sessionId} captureId=${capture.id}`);
        res.status(201).json(success({
            captureId: capture.id,
            expiresAt: capture.expiresAt.toISOString(),
            ttlDays: Math.round(DEBUG_QUEUE_TTL_MS['user-report'] / (24 * 3600 * 1000)),
        }));
    }),
);

export default router;
