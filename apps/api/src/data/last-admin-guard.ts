/**
 * 마지막 활성 관리자 보호(권한 보강, 2026-11-07 점검) — 역할 변경·비활성화로 활성 관리자가 0명이 되지 않게 한다.
 * changeRole·updateUser 의 트랜잭션 안에서 UPDATE 전에 부른다.
 *
 * @module data/last-admin-guard
 */
import type { TransactionClient } from './retry-wrapper';
import { AppError } from '../utils/error-handler';
import { USER_ROLES, isAdminRole, type UserRole } from './user-manager';

export const LAST_ADMIN_ERROR_CODE = 'LAST_ADMIN';
export const LAST_ADMIN_ERROR_MESSAGE = '마지막 관리자는 강등·비활성화할 수 없습니다';

interface LockedUserRow {
    id: string;
    role: string;
    is_active: boolean;
}

/**
 * 요청이 대상의 활성 관리자 자격을 없애고, 그 대상 외에 활성 관리자가 없으면 409 AppError.
 * 대상 행과 활성 관리자 행을 한 쿼리로 id 순서대로 잠가, 동시 요청이 같은 조건을 보고 교착 없이 줄을 선다.
 */
export async function assertNotLastActiveAdmin(
    client: TransactionClient,
    userId: string,
    updates: { role?: UserRole; is_active?: boolean },
): Promise<void> {
    const removesAdmin = (updates.role !== undefined && !isAdminRole(updates.role)) || updates.is_active === false;
    if (!removesAdmin) return;

    const { rows } = await client.query(
        `SELECT id, role, is_active FROM users
          WHERE id = $1 OR (role = $2 AND is_active = TRUE)
          ORDER BY id FOR UPDATE`,
        [userId, USER_ROLES.ADMIN],
    );
    const locked = rows as LockedUserRow[];
    const isActiveAdmin = (r: LockedUserRow) => isAdminRole(r.role) && !!r.is_active;
    const target = locked.find((r) => String(r.id) === String(userId));
    if (!target || !isActiveAdmin(target)) return;

    const others = locked.filter((r) => String(r.id) !== String(userId) && isActiveAdmin(r));
    if (others.length === 0) {
        throw new AppError(LAST_ADMIN_ERROR_MESSAGE, 409, true, LAST_ADMIN_ERROR_CODE);
    }
}
