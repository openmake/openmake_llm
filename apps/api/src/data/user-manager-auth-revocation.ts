/**
 * 사용자 인증 철회 발행(보안 점검 A3 보조 방어) — user-manager 의 갱신·삭제가 실제로 행을 바꾼 뒤에만
 * USER_AUTH_REVOKED 를 발행해, ws 계층(sockets/ws-user-eviction)이 그 사용자의 열린 채팅 소켓을 닫게 한다.
 * user-manager.ts 에서 분리(파일 크기 가드).
 *
 * @module data/user-manager-auth-revocation
 */
import { getPool } from './models/unified-database';
import { emitUserAuthRevoked, type UserAuthRevokedEvent } from '../utils/event-bus';

export { emitUserAuthRevoked };

/** UPDATE 가 행을 바꿨으면 발행하고 true — 대상이 없으면 발행 없이 false. */
export function emitRevokedIfUpdated(rowCount: number | null, userId: string, reason: UserAuthRevokedEvent['reason']): boolean {
    if ((rowCount || 0) === 0) return false;
    emitUserAuthRevoked({ userId, reason });
    return true;
}

/**
 * updateUser 용 — UPDATE **전에** 부르고, 돌려받은 함수를 UPDATE 성공 뒤에 부른다.
 * 관리 화면은 저장할 때마다 role 을 보내므로 이전 role 을 읽어 두고 실제로 바뀐 때만 role_changed 를 낸다.
 */
export async function prepareUpdateUserRevocations(
    userId: string,
    updates: { role?: string; is_active?: boolean; password?: string },
): Promise<() => void> {
    const prevRole = updates.role === undefined
        ? undefined
        : (await getPool().query('SELECT role FROM users WHERE id = $1', [userId])).rows[0]?.role;
    return () => {
        if (updates.is_active === false) emitUserAuthRevoked({ userId, reason: 'account_disabled' });
        if (updates.role !== undefined && prevRole !== updates.role) emitUserAuthRevoked({ userId, reason: 'role_changed' });
        if (updates.password !== undefined) emitUserAuthRevoked({ userId, reason: 'password_changed' });
    };
}
