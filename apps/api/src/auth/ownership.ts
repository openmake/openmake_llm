import { AuthorizationError } from '../utils/error-handler';

const EMPTY_ID_STRINGS = new Set(['', 'undefined', 'null']);

/** 호출처가 String(null)/String(undefined) 로 넘긴 값도 빈값으로 본다 */
function isEmptyId(id: unknown): boolean {
    return id === null || id === undefined || EMPTY_ID_STRINGS.has(String(id).trim());
}

/**
 * Asserts that the request user owns the resource, or is an admin.
 * Throws AuthorizationError (403) if access is denied.
 *
 * @param resourceOwnerId - The user_id of the resource owner
 * @param requestUserId - The user_id of the requesting user
 * @param userRole - The role of the requesting user ('admin', 'user', etc.)
 * @throws AuthorizationError if not owner and not admin
 */
export function assertResourceOwnerOrAdmin(
    resourceOwnerId: string,
    requestUserId: string,
    userRole: string
): void {
    if (userRole === 'admin') return;
    // 빈값끼리의 동등 비교('undefined'==='undefined')로 통과하지 않도록 양쪽 모두 실값일 때만 소유자 판정
    if (isEmptyId(resourceOwnerId) || isEmptyId(requestUserId)) {
        throw new AuthorizationError('접근 권한이 없습니다');
    }
    if (String(resourceOwnerId) === String(requestUserId)) return;
    throw new AuthorizationError('접근 권한이 없습니다');
}
