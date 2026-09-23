/**
 * Knowledge 라우트 공용 요청 헬퍼 — 사용자 id 해석과 관리자 게이트. 라우트는 `requireAuth` 뒤에서만 부른다.
 *
 * @module addons/knowledge-runtime/http
 */
import type { Request } from 'express';
import { AppError } from '../../utils/error-handler';
import { isAdminRole } from '../../data/user-manager';

/** req.user(PublicUser 또는 AuthUser)에서 사용자 id 를 문자열로 뽑는다. requireAuth 뒤라 항상 존재. */
export function resolveUserId(req: Request): string {
    const u = req.user;
    if (u && 'userId' in u && typeof u.userId === 'string') return u.userId;
    if (u && 'id' in u && u.id !== undefined && u.id !== null) return String(u.id);
    throw new AppError('인증이 필요합니다', 401, true, 'UNAUTHORIZED');
}

/** 관리자가 아니면 403 을 던진다 — errorHandler 가 AppError 를 상태코드로 매핑. */
export function assertAdmin(req: Request): void {
    const role = req.user?.role;
    if (!isAdminRole(role)) {
        throw new AppError('관리자 권한이 필요합니다', 403, true, 'FORBIDDEN');
    }
}
