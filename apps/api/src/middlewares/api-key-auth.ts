/**
 * API Key 인증 미들웨어
 * 
 * 2가지 방법으로 API Key를 추출:
 *   1. X-API-Key 헤더 (권장)
 *   2. Authorization: Bearer omk_live_... (OpenAI 호환)
 * 
 * HMAC-SHA-256 해싱 + timing-safe 비교로 검증
 */

import { Request, Response, NextFunction } from 'express';
import { hashApiKey, isValidApiKeyFormat, API_KEY_PREFIX } from '../auth/api-key-utils';
import { getUnifiedDatabase } from '../data/models/unified-database';
import { error as apiError, ErrorCodes } from '../utils/api-response';
import { createLogger } from '../utils/logger';
import { apiKeyHasScope, type ApiKeyScope } from '../config/api-key-scopes';

const logger = createLogger('ApiKeyAuth');

/**
 * API Key에서 평문 키를 추출
 * 우선순위: X-API-Key > Authorization: Bearer
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

    // 쿼리 파라미터 ?api_key= 는 2025-06-01부로 제거됨
    // X-API-Key 헤더 또는 Authorization: Bearer 사용 필요
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
            'API key is required. Provide via X-API-Key header or Authorization: Bearer.'
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
 * JWT 또는 API Key 병용 필수 인증 (2026-08-21, CLI 브리지·에이전트 작업용).
 * Authorization/X-API-Key 에 omk_live_ 키가 있으면 API Key 경로로, 아니면 기존 requireAuth(JWT).
 */
export async function requireAuthOrApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (extractApiKey(req)) {
        await requireApiKey(req, res, next);
        return;
    }
    const { requireAuth } = await import('../auth/middleware');
    await requireAuth(req, res, next);
}

/** 인증 통과한 요청이 API Key 라면 요구 스코프를 가졌는지 검사(JWT/쿠키 인증은 스코프 무관 통과). */
function enforceApiKeyScope(req: Request, res: Response, scope: ApiKeyScope): boolean {
    if (req.authMethod !== 'api-key') return true; // JWT/쿠키 유저는 스코프 개념 없음
    const scopes = req.apiKeyRecord?.scopes as string[] | undefined;
    if (apiKeyHasScope(scopes, scope)) return true;
    res.status(403).json(apiError(
        ErrorCodes.FORBIDDEN,
        `이 API key 는 '${scope}' 스코프가 없습니다. 해당 스코프의 키를 발급하세요.`,
    ));
    return false;
}

/**
 * 스코프 검사만 수행 (재인증 없음) — 상위에서 requireApiKey 가 이미 인증을 마친 경로용.
 * v1 처럼 전역 requireApiKey 뒤에 특정 하위 경로만 스코프로 좁힐 때 사용한다.
 */
export function requireScope(scope: ApiKeyScope) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (enforceApiKeyScope(req, res, scope)) next();
    };
}

/**
 * JWT 또는 (요구 스코프를 가진) API Key 병용 인증 (2026-08-21). 로컬 브리지·에이전트 작업
 * REST 에 사용 — 웹(JWT)은 그대로, CLI(API Key)는 bridge 스코프를 요구한다.
 */
export function requireAuthOrApiKeyScope(scope: ApiKeyScope) {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        await requireAuthOrApiKey(req, res, () => {
            if (enforceApiKeyScope(req, res, scope)) next();
        });
    };
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
