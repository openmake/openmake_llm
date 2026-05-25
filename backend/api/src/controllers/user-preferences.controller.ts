/**
 * ============================================================
 * User Preferences Controller — Custom Instructions GET/PUT
 * ============================================================
 *
 * 사용자별 영구 system prompt 지시문 (Custom Instructions) 조회·갱신.
 * claude.ai / ChatGPT 의 Custom Instructions 동등 기능 — 매 chat 요청 시
 * ChatService 가 조회해서 system prompt 앞에 prepend.
 *
 * 도입 배경 (2026-05-26): T1~T9 분석 루프의 inter-turn verbosity 해결책.
 *
 * Endpoints:
 *   GET  /api/users/me/custom-instructions   — { customInstructions: string | null }
 *   PUT  /api/users/me/custom-instructions   — { customInstructions: string } body
 *
 * 검증:
 *   - 인증 필수 (requireAuth)
 *   - 최대 길이: env CUSTOM_INSTRUCTIONS_MAX_CHARS (default 4000)
 *   - 빈 문자열 / null → NULL 로 정규화 (미적용)
 *
 * @module controllers/user-preferences
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware';
import { validate } from '../middlewares/validation';
import { getPool } from '../data/models/unified-database';
import { UserRepository } from '../data/repositories/user-repository';
import { createLogger } from '../utils/logger';
import { success, internalError, unauthorized } from '../utils/api-response';

const log = createLogger('UserPreferencesController');

const MAX_CHARS = Number(process.env.CUSTOM_INSTRUCTIONS_MAX_CHARS || '4000');

const updateSchema = z.object({
    customInstructions: z.string().max(MAX_CHARS, `최대 ${MAX_CHARS}자까지 허용됩니다.`).nullable(),
});

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

export function createUserPreferencesController(): Router {
    const router = Router();

    /**
     * GET /api/users/me/custom-instructions
     * 현재 사용자의 custom_instructions 조회.
     */
    router.get('/custom-instructions', requireAuth, async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(unauthorized('사용자 식별 실패'));
            return;
        }
        try {
            const repo = new UserRepository(getPool());
            const instructions = await repo.getCustomInstructions(userId);
            res.json(success({ customInstructions: instructions, maxChars: MAX_CHARS }));
        } catch (err) {
            log.error('custom_instructions 조회 실패:', err);
            res.status(500).json(internalError('지시문 조회 실패'));
        }
    });

    /**
     * PUT /api/users/me/custom-instructions
     * body: { customInstructions: string | null }
     */
    router.put(
        '/custom-instructions',
        requireAuth,
        validate(updateSchema),
        async (req: Request, res: Response) => {
            const userId = getUserId(req);
            if (!userId) {
                res.status(401).json(unauthorized('사용자 식별 실패'));
                return;
            }
            try {
                const { customInstructions } = req.body as { customInstructions: string | null };
                const repo = new UserRepository(getPool());
                await repo.updateCustomInstructions(userId, customInstructions);
                log.info(`custom_instructions 갱신: userId=${userId} len=${customInstructions?.length ?? 0}`);
                res.json(success({ saved: true, length: customInstructions?.trim().length ?? 0 }));
            } catch (err) {
                log.error('custom_instructions 갱신 실패:', err);
                res.status(500).json(internalError('지시문 저장 실패'));
            }
        },
    );

    return router;
}
