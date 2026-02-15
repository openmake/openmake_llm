/**
 * ============================================================
 * API Keys Routes - API Key 관리 라우트
 * ============================================================
 *
 * 외부 개발자용 API Key의 발급, 조회, 수정, 삭제, 순환(rotate) 및
 * 사용량 조회를 담당하는 REST API입니다.
 * 등급별(free/pro/enterprise) 키 발급 수량을 제한하며,
 * 평문 키는 생성/순환 시 한 번만 노출됩니다.
 *
 * @module routes/api-keys.routes
 * @description
 * - POST   /api/v1/api-keys              - 새 API Key 생성 (인증, Zod 검증)
 * - GET    /api/v1/api-keys              - 사용자의 API Key 목록 (인증)
 * - GET    /api/v1/api-keys/:id          - 단일 API Key 상세 (인증)
 * - PATCH  /api/v1/api-keys/:id          - API Key 수정 (인증, Zod 검증)
 * - DELETE /api/v1/api-keys/:id          - API Key 삭제 (인증)
 * - POST   /api/v1/api-keys/:id/rotate   - API Key 순환 (인증)
 * - GET    /api/v1/api-keys/:id/usage    - API Key 사용량 조회 (인증)
 *
 * @requires requireAuth - JWT 인증 미들웨어
 * @requires validate - Zod 스키마 검증 미들웨어
 * @requires ApiKeyService - API Key 라이프사이클 서비스
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

/**
 * API Key 생성 요청 Zod 스키마
 * @property {string} name - 키 이름 (1~100자, 필수)
 * @property {string} [description] - 키 설명 (최대 500자)
 * @property {string[]} [scopes] - 접근 범위 목록
 * @property {string[]} [allowed_models] - 허용 모델 목록
 * @property {string} [rate_limit_tier] - Rate Limit 등급 (free/starter/standard/enterprise)
 * @property {string} [expires_at] - 만료 일시 (ISO 8601 datetime)
 */
const createApiKeySchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    scopes: z.array(z.string()).optional(),
    allowed_models: z.array(z.string()).optional(),
    rate_limit_tier: z.enum(['free', 'starter', 'standard', 'enterprise']).optional(),
    expires_at: z.string().datetime().optional(),
});

/**
 * API Key 수정 요청 Zod 스키마
 * @property {string} [name] - 키 이름 (1~100자)
 * @property {string} [description] - 키 설명 (최대 500자)
 * @property {string[]} [scopes] - 접근 범위 목록
 * @property {string[]} [allowed_models] - 허용 모델 목록
 * @property {string} [rate_limit_tier] - Rate Limit 등급
 * @property {boolean} [is_active] - 활성화 상태
 * @property {string|null} [expires_at] - 만료 일시 (null = 무기한)
 */
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

/**
 * 요청 객체에서 인증된 사용자 ID를 추출합니다.
 * JWT 페이로드의 userId 또는 id 필드를 확인합니다.
 * @param req - Express 요청 객체
 * @returns 사용자 ID 문자열 또는 null
 */
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
