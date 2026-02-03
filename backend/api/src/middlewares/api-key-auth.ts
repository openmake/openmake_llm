/**
 * API Key 인증 미들웨어
 * 
 * 3가지 방법으로 API Key를 추출:
 *   1. X-API-Key 헤더 (권장)
 *   2. Authorization: Bearer omk_live_... (OpenAI 호환)
 *   3. ?api_key=omk_live_... 쿼리 파라미터 (GET 전용, Gemini 호환)
 * 
 * HMAC-SHA-256 해싱 + timing-safe 비교로 검증
 */

import { Request, Response, NextFunction } from 'express';
import { hashApiKey, isValidApiKeyFormat, API_KEY_PREFIX } from '../auth/api-key-utils';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { isValidBrandModel } from '../chat/pipeline-profile';
import { error as apiError, ErrorCodes } from '../utils/api-response';
import { createLogger } from '../utils/logger';

const logger = createLogger('ApiKeyAuth');

/**
 * API Key에서 평문 키를 추출
 * 우선순위: X-API-Key > Authorization: Bearer > ?api_key=
 */
function extractApiKey(req: Request): string | undefined {
    // 1. X-API-Key 헤더
    const xApiKey = req.headers['x-api-key'];
    if (typeof xApiKey === 'string' && xApiKey.startsWith(API_KEY_PREFIX)) {
        return xApiKey;
    }

    // 2. Authorization: Bearer (omk_live_ 접두사만 처리 — JWT Bearer는 기존 auth에서 처리)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        if (token.startsWith(API_KEY_PREFIX)) {
            return token;
        }
    }

    // 3. 쿼리 파라미터 (GET 요청만)
    if (req.method === 'GET' && req.query.api_key) {
        const queryKey = req.query.api_key as string;
        if (queryKey.startsWith(API_KEY_PREFIX)) {
            return queryKey;
        }
    }

    return undefined;
}

/**
 * API Key 인증 필수 미들웨어
 * API Key가 없거나 유효하지 않으면 401 반환
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const plainKey = extractApiKey(req);

    if (!plainKey) {
        res.status(401).json(apiError(
            ErrorCodes.UNAUTHORIZED,
            'API key is required. Provide via X-API-Key header, Authorization: Bearer, or ?api_key= query parameter.'
        ));
        return;
    }

    if (!isValidApiKeyFormat(plainKey)) {
        res.status(401).json(apiError(
            ErrorCodes.UNAUTHORIZED,
            'Invalid API key format. Keys must start with omk_live_ followed by a hex string.'
        ));
        return;
    }

    try {
        const keyHash = hashApiKey(plainKey);
        const db = getUnifiedDatabase();
        const keyRecord = await db.getApiKeyByHash(keyHash);

        if (!keyRecord) {
            res.status(401).json(apiError(
                ErrorCodes.UNAUTHORIZED,
                'Invalid API key.'
            ));
            return;
        }

        // 만료 확인
        if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
            res.status(401).json(apiError(
                ErrorCodes.UNAUTHORIZED,
                'API key has expired.'
            ));
            return;
        }

        // 비활성 확인
        if (!keyRecord.is_active) {
            res.status(401).json(apiError(
                ErrorCodes.UNAUTHORIZED,
                'API key is deactivated.'
            ));
            return;
        }

        // §9.14.2 allowed_models 검증 — 브랜드 별칭 기준 비교
        const requestedModel = (req.body as Record<string, unknown>)?.model as string | undefined;
        if (requestedModel && keyRecord.allowed_models) {
            const allowedModels = keyRecord.allowed_models as string[];
            // ['*']이면 모든 모델 허용
            const isWildcard = allowedModels.length === 1 && allowedModels[0] === '*';
            if (!isWildcard && isValidBrandModel(requestedModel) && !allowedModels.includes(requestedModel)) {
                res.status(403).json(apiError(
                    ErrorCodes.FORBIDDEN,
                    `Model '${requestedModel}' is not allowed for this API key. Allowed models: ${allowedModels.join(', ')}`,
                    { allowed_models: allowedModels }
                ));
                return;
            }
        }

        // Request에 API Key 정보 첨부
        req.authMethod = 'api-key';
        req.apiKeyId = keyRecord.id;
        req.apiKeyRecord = keyRecord;

        // user 정보도 채워서 기존 requireAuth 의존 코드와 호환
        if (!req.user) {
            const user = await db.getUserById(keyRecord.user_id);
            if (user) {
                req.user = {
                    userId: user.id,
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    role: user.role as 'admin' | 'user' | 'guest',
                    is_active: user.is_active
                };
            }
        }

        next();
    } catch (err) {
        logger.error('API Key 인증 오류:', err);
        res.status(500).json(apiError(
            ErrorCodes.INTERNAL_ERROR,
            'Authentication service error.'
        ));
    }
}

/**
 * API Key 인증 선택적 미들웨어
 * API Key가 있으면 검증하고 req에 첨부, 없으면 통과
 * 기존 optionalAuth와 결합하여 JWT 또는 API Key 인증 지원
 */
export async function optionalApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    const plainKey = extractApiKey(req);

    // API Key가 없으면 그냥 통과 (기존 JWT auth로 처리될 수 있음)
    if (!plainKey) {
        next();
        return;
    }

    // API Key가 있으면 requireApiKey와 동일한 로직
    await requireApiKey(req, res, next);
}
