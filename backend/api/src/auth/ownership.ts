import { AuthorizationError } from '../utils/error-handler';

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
    if (String(resourceOwnerId) === String(requestUserId)) return;
    throw new AuthorizationError('접근 권한이 없습니다');
}
