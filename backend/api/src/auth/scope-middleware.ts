/**
 * Scope Verification Middleware
 * 
 * API Key의 scopes 필드를 기반으로 엔드포인트 접근을 제어합니다.
 * 
 * Scope 형식: "resource:action" (예: "chat:write", "models:read", "keys:admin")
 * 와일드카드: "*" (모든 scope 허용)
 * 
 * @see docs/api/API_KEY_SERVICE_PLAN.md §7 Security
 */

import { Request, Response, NextFunction } from 'express';
import { error as apiError, ErrorCodes } from '../utils/api-response';

/**
 * 요청된 scope가 허용된 scopes에 포함되는지 확인
 */
function hasScope(allowedScopes: string[], requiredScope: string): boolean {
    // 와일드카드 허용
    if (allowedScopes.includes('*')) return true;

    // 정확한 매칭
    if (allowedScopes.includes(requiredScope)) return true;

    // 리소스 와일드카드 (예: "chat:*" → "chat:write" 허용)
    const [resource] = requiredScope.split(':');
    if (allowedScopes.includes(`${resource}:*`)) return true;

    return false;
}

/**
 * Scope 검증 미들웨어 팩토리
 * 
 * @param requiredScope - 필요한 scope (예: "chat:write")
 * @returns Express 미들웨어
 * 
 * @example
 * router.post('/chat', requireScope('chat:write'), asyncHandler(...));
 * router.get('/models', requireScope('models:read'), asyncHandler(...));
 */
export function requireScope(requiredScope: string) {
    return (req: Request, res: Response, next: NextFunction): void => {
        // API Key 인증이 아닌 경우 (JWT 인증 등) → scope 검증 스킵
        if (!req.apiKeyRecord) {
            next();
            return;
        }

        const allowedScopes = req.apiKeyRecord.scopes || ['*'];

        if (!hasScope(allowedScopes, requiredScope)) {
            res.status(403).json(apiError(
                ErrorCodes.FORBIDDEN,
                `Insufficient scope. Required: "${requiredScope}". Your key has: [${allowedScopes.join(', ')}]`,
                {
                    required_scope: requiredScope,
                    available_scopes: allowedScopes,
                    documentation_url: '/developer#scopes'
                }
            ));
            return;
        }

        next();
    };
}

/**
 * 여러 scope 중 하나라도 있으면 허용하는 미들웨어
 * 
 * @param scopes - 허용할 scope 목록 (OR 조건)
 */
export function requireAnyScope(...scopes: string[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.apiKeyRecord) {
            next();
            return;
        }

        const allowedScopes = req.apiKeyRecord.scopes || ['*'];
        const hasAny = scopes.some(scope => hasScope(allowedScopes, scope));

        if (!hasAny) {
            res.status(403).json(apiError(
                ErrorCodes.FORBIDDEN,
                `Insufficient scope. Required one of: [${scopes.join(', ')}]. Your key has: [${allowedScopes.join(', ')}]`,
                {
                    required_scopes: scopes,
                    available_scopes: allowedScopes,
                    documentation_url: '/developer#scopes'
                }
            ));
            return;
        }

        next();
    };
}
