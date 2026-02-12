/**
 * API Keys 라우트
 * 
 * REST API for managing user API keys
 * 
 * Endpoints:
 *   POST   /api/v1/api-keys              — 새 API Key 생성
 *   GET    /api/v1/api-keys              — 사용자의 API Key 목록
 *   GET    /api/v1/api-keys/:id          — 단일 API Key 상세
 *   PATCH  /api/v1/api-keys/:id          — API Key 수정
 *   DELETE /api/v1/api-keys/:id          — API Key 삭제
 *   POST   /api/v1/api-keys/:id/rotate   — API Key 순환
 *   GET    /api/v1/api-keys/:id/usage    — API Key 사용량 조회
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { validate } from '../middlewares/validation';
import { asyncHandler } from '../utils/error-handler';
import { success, notFound, badRequest, forbidden } from '../utils/api-response';
import { getApiKeyService, ApiKeyError } from '../services/ApiKeyService';
import type { ApiKeyTier } from '../data/models/unified-database';

const router = Router();

// ===== Validation Schemas =====

const createApiKeySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    scopes: z.array(z.string()).optional(),
    allowed_models: z.array(z.string()).optional(),
    rate_limit_tier: z.enum(['free', 'starter', 'standard', 'enterprise']).optional(),
    expires_at: z.string().datetime().optional(),
});

const updateApiKeySchema = z.object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    scopes: z.array(z.string()).optional(),
    allowed_models: z.array(z.string()).optional(),
    rate_limit_tier: z.enum(['free', 'starter', 'standard', 'enterprise']).optional(),
    is_active: z.boolean().optional(),
    expires_at: z.string().datetime().nullable().optional(),
});

// ===== Helper =====

function getUserId(req: Request): string | null {
    if (req.user && 'userId' in req.user) {
        return req.user.userId;
    }
    if (req.user && 'id' in req.user) {
        return String(req.user.id);
    }
    return null;
}

// ===== Routes =====

/**
 * POST /api-keys — 새 API Key 생성
 */
router.post('/',
    requireAuth,
    validate(createApiKeySchema),
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();

        // 등급별 API 키 발급 수량 제한
        const API_KEY_LIMITS: Record<string, number> = {
            free: 2,
            pro: 10,
            enterprise: 50
        };
        const userTier = (req.user && 'tier' in req.user) ? (req.user as { tier: string }).tier : 'free';
        const userRole = req.user?.role || 'user';
        const keyLimit = userRole === 'admin' ? Infinity : (API_KEY_LIMITS[userTier] || API_KEY_LIMITS['free']);

        if (keyLimit !== Infinity) {
            const existingKeys = await service.listKeys(userId);
            if (existingKeys.length >= keyLimit) {
                res.status(403).json(forbidden(`API 키 발급 제한 초과 (${userTier}: 최대 ${keyLimit}개)`));
                return;
            }
        }

        try {
            const result = await service.createKey({
                userId,
                name: req.body.name,
                description: req.body.description,
                scopes: req.body.scopes,
                allowedModels: req.body.allowed_models,
                rateLimitTier: req.body.rate_limit_tier as ApiKeyTier | undefined,
                expiresAt: req.body.expires_at,
            });

            // 평문 키는 이 응답에서만 노출됨
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            res.status(201).json(success({
                key: result.plainKey,
                api_key: result.apiKey,
                quick_start: {
                    curl: `curl -X POST ${baseUrl}/api/v1/chat \\\n  -H "Content-Type: application/json" \\\n  -H "X-API-Key: ${result.plainKey}" \\\n  -d '{"message": "Hello!", "model": "openmake_llm"}'`,
                    models_url: `${baseUrl}/api/v1/models`,
                    docs_url: `${baseUrl}/developer`,
                },
            }));
        } catch (err) {
            if (err instanceof ApiKeyError && err.code === 'KEY_LIMIT_EXCEEDED') {
                res.status(429).json(badRequest(err.message));
                return;
            }
            throw err;
        }
    })
);

/**
 * GET /api-keys — 사용자의 API Key 목록
 */
router.get('/',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();
        const includeInactive = req.query.include_inactive === 'true';
        const limit = parseInt(req.query.limit as string, 10) || 50;
        const offset = parseInt(req.query.offset as string, 10) || 0;

        const keys = await service.listKeys(userId, { includeInactive, limit, offset });

        res.json(success({ api_keys: keys, count: keys.length }));
    })
);

/**
 * GET /api-keys/:id — 단일 API Key 상세
 */
router.get('/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();
        const key = await service.getKey(req.params.id, userId);

        if (!key) {
            res.status(404).json(notFound('API Key'));
            return;
        }

        res.json(success({ api_key: key }));
    })
);

/**
 * PATCH /api-keys/:id — API Key 수정
 */
router.patch('/:id',
    requireAuth,
    validate(updateApiKeySchema),
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();
        const updated = await service.updateKey(req.params.id, userId, {
            name: req.body.name,
            description: req.body.description,
            scopes: req.body.scopes,
            allowedModels: req.body.allowed_models,
            rateLimitTier: req.body.rate_limit_tier as ApiKeyTier | undefined,
            isActive: req.body.is_active,
            expiresAt: req.body.expires_at,
        });

        if (!updated) {
            res.status(404).json(notFound('API Key'));
            return;
        }

        res.json(success({ api_key: updated }));
    })
);

/**
 * DELETE /api-keys/:id — API Key 삭제
 */
router.delete('/:id',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();
        const deleted = await service.deleteKey(req.params.id, userId);

        if (!deleted) {
            res.status(404).json(notFound('API Key'));
            return;
        }

        res.json(success({ deleted: true }));
    })
);

/**
 * POST /api-keys/:id/rotate — API Key 순환
 */
router.post('/:id/rotate',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();

        try {
            const result = await service.rotateKey(req.params.id, userId);

            if (!result) {
                res.status(404).json(notFound('API Key'));
                return;
            }

            // 새 평문 키 반환
            res.json(success({
                key: result.plainKey,
                api_key: result.apiKey,
            }));
        } catch (err) {
            if (err instanceof ApiKeyError && err.code === 'KEY_INACTIVE') {
                res.status(400).json(badRequest(err.message));
                return;
            }
            throw err;
        }
    })
);

/**
 * GET /api-keys/:id/usage — API Key 사용량 조회
 */
router.get('/:id/usage',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const userId = getUserId(req);
        if (!userId) {
            res.status(401).json(forbidden('User ID not found.'));
            return;
        }

        const service = getApiKeyService();
        const stats = await service.getUsageStats(req.params.id, userId);

        if (!stats) {
            res.status(404).json(notFound('API Key'));
            return;
        }

        res.json(success({
            usage: {
                total_requests: stats.totalRequests,
                total_tokens: stats.totalTokens,
                last_used_at: stats.lastUsedAt,
            }
        }));
    })
);

export default router;
