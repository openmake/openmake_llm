/**
 * updateUser 의 UPDATE 문 조립 — user-manager.ts 에서 분리(파일 크기 가드). 동작은 종전과 같다.
 *
 * @module data/user-manager-update
 */
import type { UserRole } from './user-manager';

/** passwordHash 는 updates.password 가 있을 때 호출부가 bcrypt 로 만든 값. */
export function buildUpdateUserStatement(
    userId: string,
    updates: { email?: string; role?: UserRole; is_active?: boolean; password?: string },
    passwordHash: string | undefined,
): { sql: string; params: (string | number | boolean | Date)[] } {
    const sets: string[] = ['updated_at = $1'];
    const params: (string | number | boolean | Date)[] = [new Date().toISOString()];
    let paramIdx = 2;

    if (updates.email !== undefined) {
        sets.push(`username = $${paramIdx++}`);
        params.push(updates.email);
        sets.push(`email = $${paramIdx++}`);
        params.push(updates.email);
    }
    if (updates.role !== undefined) {
        sets.push(`role = $${paramIdx++}`);
        params.push(updates.role);
    }
    if (updates.is_active !== undefined) {
        sets.push(`is_active = $${paramIdx++}`);
        params.push(updates.is_active);
    }
    if (passwordHash !== undefined) {
        sets.push(`password_hash = $${paramIdx++}`);
        params.push(passwordHash);
        // 보안 점검 A2 — 관리자 재설정도 같은 UPDATE 로 이전 토큰을 끊는다.
        sets.push(`tokens_valid_after = $${paramIdx++}`);
        params.push(new Date());
    }

    params.push(userId);
    return { sql: `UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIdx}`, params };
}
