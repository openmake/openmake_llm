/**
 * 로그인 실패 계정 잠금(W3 S7) — users.failed_login_count / locked_until(마이그레이션 192) 갱신.
 *
 * 카운터는 계정 단위(IP 아님). 192 미적용 DB(pg 42703)에서는 한 번 경고하고 잠금 없이 종전 동작으로 돌아간다.
 * 호출부: data/user-manager.ts authenticateDetailed. 설정: config/rate-limits.ts AUTH_LOCKOUT.
 *
 * @module data/user-login-lockout
 */
import { getPool } from './models/unified-database';
import { AUTH_LOCKOUT } from '../config/rate-limits';
import { createLogger } from '../utils/logger';

const logger = createLogger('UserLoginLockout');

/** pg undefined_column — 192(로그인 잠금 열) 미적용 DB. */
const PG_UNDEFINED_COLUMN = '42703';
/** 192 미적용을 한 번 본 뒤로는 잠금 SQL 을 보내지 않는다(경고도 한 번만). */
let lockoutColumnsMissing = false;

function isUndefinedColumnError(err: unknown): boolean {
    return (err as { code?: unknown } | null)?.code === PG_UNDEFINED_COLUMN;
}

function markLockoutColumnsMissing(): void {
    if (lockoutColumnsMissing) return;
    lockoutColumnsMissing = true;
    logger.warn('[auth] users.failed_login_count/locked_until 없음(마이그레이션 192 미적용) — 계정 잠금 없이 로그인한다');
}

/** 잠금을 적용할지 — 설정 ON 이고 192 미적용을 아직 보지 않았을 때. */
export function isLockoutActive(): boolean {
    return AUTH_LOCKOUT.ENABLED && !lockoutColumnsMissing;
}

const LOGIN_ROW_SQL = 'SELECT * FROM users WHERE (email = $1 OR username = $1) AND is_active = TRUE';
/** 잠금 판정은 DB 시계로 — 앱 서버와 DB 의 시계 차이가 판정을 흔들지 않게 한다. */
const LOGIN_ROW_WITH_LOCK_SQL =
    'SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS locked_now FROM users WHERE (email = $1 OR username = $1) AND is_active = TRUE';

/**
 * 로그인 대상 행 조회. 잠금이 켜져 있으면 `locked_now`(DB 가 판정한 진행 중 잠금)를 함께 싣는다.
 * 192 미적용(42703)이면 한 번 경고하고 종전 SELECT 로 다시 읽는다(이후 isLockoutActive()=false).
 */
export async function selectLoginRow<T extends object>(identifier: string): Promise<(T & { locked_now?: boolean }) | undefined> {
    const pool = getPool();
    if (isLockoutActive()) {
        try {
            return (await pool.query(LOGIN_ROW_WITH_LOCK_SQL, [identifier])).rows[0];
        } catch (err) {
            if (!isUndefinedColumnError(err)) throw err;
            markLockoutColumnsMissing();
        }
    }
    return (await pool.query(LOGIN_ROW_SQL, [identifier])).rows[0];
}

/** 만료된 잠금(locked_until 이 지난 행)은 이번 실패를 1회째로 다시 센다. */
const COUNT_AFTER_FAILURE_SQL = 'CASE WHEN locked_until IS NOT NULL AND locked_until <= NOW() THEN 1 ELSE failed_login_count + 1 END';

/**
 * 실패 1회 기록 — 새 카운트가 THRESHOLD 이상이면 같은 UPDATE 가 locked_until 을 NOW() + LOCK_MS 로 정한다.
 * 그 밖에는 locked_until 을 NULL 로 정리한다(진행 중 잠금은 bcrypt 전에 걸러지므로 여기 오지 않는다).
 */
export async function recordFailedLogin(userId: string): Promise<void> {
    try {
        await getPool().query(
            `UPDATE users SET failed_login_count = ${COUNT_AFTER_FAILURE_SQL},
                locked_until = CASE WHEN (${COUNT_AFTER_FAILURE_SQL}) >= $2 THEN NOW() + make_interval(secs => $3 / 1000.0) ELSE NULL END
             WHERE id = $1`,
            [userId, AUTH_LOCKOUT.THRESHOLD, AUTH_LOCKOUT.LOCK_MS]
        );
    } catch (err) {
        if (!isUndefinedColumnError(err)) throw err;
        markLockoutColumnsMissing();
    }
}

/** 성공 기록 — last_login 갱신, resetLockout 이면 카운터·잠금도 초기화(192 미적용이면 last_login 만). */
export async function recordSuccessfulLogin(userId: string, now: string, resetLockout: boolean): Promise<void> {
    const pool = getPool();
    if (resetLockout) {
        try {
            await pool.query('UPDATE users SET last_login = $1, failed_login_count = 0, locked_until = NULL WHERE id = $2', [now, userId]);
            return;
        } catch (err) {
            if (!isUndefinedColumnError(err)) throw err;
            markLockoutColumnsMissing();
        }
    }
    await pool.query('UPDATE users SET last_login = $1 WHERE id = $2', [now, userId]);
}
