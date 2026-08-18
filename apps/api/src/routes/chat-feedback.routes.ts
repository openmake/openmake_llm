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
import { ConversationRepository } from '../data/repositories/conversation-repository';
import { getPool } from '../data/models/unified-database';
import { validate } from '../middlewares/validation';
import { chatFeedbackSchema } from '../schemas/chat-feedback.schema';
import { AGENT_SELF_IMPROVE } from '../config/runtime-limits';
import { createLogger } from '../utils/logger';

const logger = createLogger('ChatFeedbackRoutes');
const router = Router();

/**
 * 채팅 피드백 신호를 자가개선(F2) 루프의 입력으로 흘려보낸다.
 *
 * 이 배선이 없어서 agent_prompt_suggestions 가 운영에서 0건이었다 — 승인 UI 가 아니라
 * 입력이 끊긴 것이 원인이었다(마이그 099 주석 참고). client_message_id 로 assistant 행을
 * 되짚어 담당 에이전트를 얻고, 직전 user 메시지를 질의로 삼아 평점 피드백으로 환산한다.
 *
 * 전 구간 fail-open — 귀속 실패가 사용자의 피드백 클릭을 깨지 않는다(fire-and-forget 호출).
 */
async function feedLearningSystem(params: {
    clientMessageId: string;
    userId?: string;
    signal: 'thumbs_up' | 'thumbs_down' | 'regenerate';
}): Promise<void> {
    const rating = AGENT_SELF_IMPROVE.SIGNAL_RATING[params.signal];
    if (!rating) return;

    const repo = new ConversationRepository(getPool());
    const row = await repo.getAssistantMessageByClientId(params.clientMessageId);
    // 귀속 불가(구 메시지·미저장 세션·에이전트 미선택) — 신호는 message_feedback 에 남고 학습만 skip
    if (!row?.agent_id) return;

    // 이 응답을 유발한 질의 = 같은 세션에서 직전 user 메시지
    const query = await repo.getPrecedingUserMessage(row.session_id, row.id);

    const { getAgentLearningSystem } = await import('../agents/learning');
    // ⚠️ tags 는 넘기지 않는다 — calculateQualityScore 가 tags 를 '주제 라벨'로 보고
    // good/bad 카운트를 집계해 강점/약점으로 승격시키기 때문이다. 채널명(chat_signal)이나
    // 신호명(thumbs_down)을 넣으면 "thumbs_down 관련 지침 강화 필요" 같은 무의미한 제안이
    // 생성된다(라이브 검증에서 실제로 발생). 신호의 의미는 rating 이 이미 담고 있다.
    await getAgentLearningSystem().collectFeedback({
        agentId: row.agent_id,
        userId: params.userId,
        rating,
        query: query ?? '',
        response: row.content,
    });
}


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

        // 자가개선(F2) 입력 배선 — 응답 지연을 만들지 않도록 fire-and-forget, 실패는 무시.
        void feedLearningSystem({ clientMessageId: messageId, userId: feedbackUserId, signal })
            .catch((e) => logger.warn(`자가개선 피드백 귀속 실패 (무시): ${e instanceof Error ? e.message : String(e)}`));

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
