/**
 * 사용자 토큰 무효화(보안 점검 A2) — users.tokens_valid_after(마이그레이션 194) 갱신.
 *
 * 이 시각 이전에 발급된 토큰은 auth/token-invalidation.ts isIssuedBeforeInvalidation 이 거부한다.
 *
 * @module data/user-manager-token-invalidation
 */
import { getPool } from './models/unified-database';
import { createLogger } from '../utils/logger';

const logger = createLogger('UserTokenInvalidation');

/** `at` 이전에 발급된 이 사용자의 모든 토큰을 무효화한다. */
export async function invalidateTokensBefore(userId: string, at: Date = new Date()): Promise<void> {
    await getPool().query('UPDATE users SET tokens_valid_after = $1 WHERE id = $2', [at, userId]);
}

/**
 * 부팅 관리자 승격·비밀번호 덮어쓰기 UPDATE(보안 점검 A11) — 같은 UPDATE 에서 tokens_valid_after = NOW() 로 이전 토큰을 끊는다.
 * server.ts 는 마이그레이션 자동 적용 뒤에 UserManager 를 초기화하지만, DB_AUTO_MIGRATE=false 이고 194 를 수동 적용하지
 * 않았으면 열이 없다. 그때(42703 undefined_column)는 열 없이 같은 UPDATE 를 다시 실행한다 — 열이 없으면 무효화 검사도 없고,
 * 부팅을 막을 이유가 없다. 다른 오류는 그대로 던진다(부팅 Fail-Fast).
 */
export async function updateUsersInvalidatingTokens(setSql: string, whereSql: string, params: unknown[]): Promise<void> {
    const pool = getPool();
    try {
        await pool.query(`UPDATE users SET ${setSql}, tokens_valid_after = NOW() WHERE ${whereSql}`, params);
    } catch (err) {
        if ((err as { code?: string }).code !== '42703') throw err;
        logger.warn(`users.tokens_valid_after 없음(마이그레이션 194 미적용, DB_AUTO_MIGRATE=false?) — 토큰 무효화 없이 갱신: ${(err as Error).message}`);
        await pool.query(`UPDATE users SET ${setSql} WHERE ${whereSql}`, params);
    }
}
