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
 *
 * 재현(F24.7, 144, 관리자):
 *   GET  /api/debug-queue/:id/replay-bundle           번들·원문(다운로드용)
 *   POST /api/debug-queue/:id/replay {model?, temperature?}  같은 입력 재전송 + 저장 응답과 유사도(분당 3회, 실제 LLM 비용)
 */

import { Router, Request, Response } from 'express';
import { success, badRequest } from '../utils/api-response';
import { asyncHandler } from '../utils/error-handler';
import { requireAuth, requireAdmin } from '../auth';
import { enqueueDebugCapture, DEBUG_QUEUE_TTL_MS, getDebugCaptureForReplay } from '../data/conversation-debug-queue';
import rateLimit from 'express-rate-limit';
import { REPLAY_CAPTURE } from '../config/runtime-limits';
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

/** 관리자 재현 대상 로드 — 만료·없는 행·번들 없는 행은 404. */
async function loadReplayable(id: string, res: Response) {
    const row = await getDebugCaptureForReplay(id);
    if (!row) { res.status(404).json(badRequest('디버그 큐 항목을 찾을 수 없습니다(만료 가능)')); return null; }
    if (!row.replayBundle) { res.status(404).json(badRequest('이 항목에는 재현 번들이 없습니다(REPLAY_CAPTURE 비활성·세션 없음·보관 시간 초과)')); return null; }
    return row;
}

router.get('/:id/replay-bundle', requireAuth, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
    const row = await loadReplayable(req.params.id, res);
    if (!row) return;
    res.json(success(row));
}));

const replayLimiter = rateLimit({
    windowMs: 60_000,
    limit: REPLAY_CAPTURE.REPLAY_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response): void => { res.status(429).json({ success: false, error: 'REPLAY_RATE_LIMIT', message: '리플레이는 분당 3회까지입니다.' }); },
});

router.post('/:id/replay', requireAuth, requireAdmin, replayLimiter, asyncHandler(async (req: Request, res: Response) => {
    const row = await loadReplayable(req.params.id, res);
    if (!row) return;
    const body = (req.body ?? {}) as { model?: unknown; temperature?: unknown };
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined;
    const temperature = typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2 ? body.temperature : undefined;
    const { runReplay } = await import('../services/replay/replay-runner');
    try {
        const result = await runReplay(row.replayBundle!, { model, temperature, expected: row.assistantMessage });
        logger.info(`[Replay] ${row.id} model=${result.model} similarity=${result.similarity?.toFixed(3)} ${result.durationMs}ms`);
        res.json(success({ id: row.id, requestId: row.requestId, ...result }));
    } catch (e) {
        res.status(400).json(badRequest(e instanceof Error ? e.message : String(e)));
    }
}));

export default router;
