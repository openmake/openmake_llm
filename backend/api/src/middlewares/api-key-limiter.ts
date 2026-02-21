/**
 * API Key 기반 Rate Limiter
 * 
 * Per-key RPM (Requests Per Minute) 제한 + TPM (Tokens Per Minute) 이중 제한
 * Tier별 차등 한도 적용
 * 
 * 표준 RateLimit 헤더 반환:
 *   RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
 * 
 * @see docs/api/API_KEY_SERVICE_PLAN.md §4 Rate Limiting
 */

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import { API_KEY_TIER_LIMITS, ApiKeyTier } from '../data/models/unified-database';
import { error as apiError, ErrorCodes } from '../utils/api-response';
import { isTPMExceeded } from './rate-limit-headers';

/**
 * Tier별 RPM 한도 조회
 */
function getTierLimit(tier: ApiKeyTier | undefined): number {
    const resolved = tier || 'free';
    return API_KEY_TIER_LIMITS[resolved].rpm;
}

/**
 * API Key 인증 요청에 대한 RPM Rate Limiter
 * 
 * - keyGenerator: API Key ID 기반 (인증된 경우) / IP 기반 (미인증)
 * - limit: Tier별 동적 한도
 * - windowMs: 1분 (RPM)
 */
export const apiKeyRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1분
    limit: (req: Request): number => {
        // API Key 인증이 되어있으면 tier에 따른 한도 적용
        if (req.apiKeyRecord) {
            return getTierLimit(req.apiKeyRecord.rate_limit_tier);
        }
        // 미인증 요청은 최소 한도
        return API_KEY_TIER_LIMITS.free.rpm;
    },

    // API Key ID 기반 분리 (키마다 독립적 카운터)
    keyGenerator: (req: Request): string => {
        if (req.apiKeyId) {
            return `apikey:${req.apiKeyId}`;
        }
        return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
    },

    // 표준 RateLimit 헤더 사용
    standardHeaders: true,
    legacyHeaders: false,

    // Rate limit 초과 시 응답
    handler: (_req: Request, res: Response): void => {
        res.status(429).json(apiError(
            ErrorCodes.RATE_LIMITED,
            'Rate limit exceeded. Please wait before making more requests.',
            {
                retry_after_seconds: 60,
                documentation_url: '/developer#rate-limits'
            }
        ));
    },

    // 실패한 요청도 카운트 (DDoS 방지)
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
});

/**
 * TPM (Tokens Per Minute) Rate Limiter 미들웨어
 * 
 * RPM과 별도로, 토큰 소비량 기반 이중 제한을 적용합니다.
 * API Key 인증 요청에만 동작합니다.
 */
export function apiKeyTPMLimiter(req: Request, res: Response, next: NextFunction): void {
    // API Key 인증이 아닌 경우 스킵
    if (!req.apiKeyId || !req.apiKeyRecord) {
        next();
        return;
    }

    const tier: ApiKeyTier = req.apiKeyRecord.rate_limit_tier || 'free';

    if (isTPMExceeded(req.apiKeyId, tier)) {
        const limits = API_KEY_TIER_LIMITS[tier];
        res.status(429).json(apiError(
            ErrorCodes.RATE_LIMITED,
            `Token rate limit exceeded. Maximum ${limits.tpm.toLocaleString()} tokens per minute for ${tier} tier.`,
            {
                type: 'tokens_per_minute',
                limit: limits.tpm,
                retry_after_seconds: 60,
                documentation_url: '/developer#rate-limits'
            }
        ));
        return;
    }

    next();
}
