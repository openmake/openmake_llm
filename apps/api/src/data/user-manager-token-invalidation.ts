/**
 * 사용자 토큰 무효화(보안 점검 A2) — users.tokens_valid_after(마이그레이션 194) 갱신.
 *
 * 이 시각 이전에 발급된 토큰은 auth/token-invalidation.ts isIssuedBeforeInvalidation 이 거부한다.
 *
 * @module data/user-manager-token-invalidation
 */
import { getPool } from './models/unified-database';

/** `at` 이전에 발급된 이 사용자의 모든 토큰을 무효화한다. */
export async function invalidateTokensBefore(userId: string, at: Date = new Date()): Promise<void> {
    await getPool().query('UPDATE users SET tokens_valid_after = $1 WHERE id = $2', [at, userId]);
}
