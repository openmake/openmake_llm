import { assertCanAccess } from '../security/authorize';

/**
 * Asserts that the request user owns the resource, or is an admin.
 * Throws AuthorizationError (403) if access is denied.
 *
 * F22 Phase A-2: security/authorize.assertCanAccess 의 얇은 래퍼(kind 'generic' = 소유자·관리자만).
 * 조직 공유 자원은 호출부가 kind 와 org 컨텍스트를 넘겨 assertCanAccess 를 직접 쓴다.
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
    assertCanAccess('generic', 'write', { ownerId: resourceOwnerId }, { userId: requestUserId, role: userRole });
}
