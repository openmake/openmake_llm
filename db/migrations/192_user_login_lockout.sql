-- Migration 192 — 로그인 실패 계정 잠금 (2026-10-23, W3 S7)
--
-- 같은 계정에 비밀번호가 연속으로 틀리면(AUTH_LOCKOUT_THRESHOLD) 일정 시간(AUTH_LOCKOUT_MS) 로그인을 막는다.
-- 카운터는 계정 단위(IP 아님) — IP 를 바꿔 가며 한 계정을 두드리는 대입 공격을 막는다. 성공하면 0 으로 돌아간다.
-- 코드: apps/api/src/data/user-manager.ts(authenticateDetailed), apps/api/src/config/rate-limits.ts(AUTH_LOCKOUT)
--
-- additive 만 — 열 추가. 멱등(IF NOT EXISTS). 코드만 되돌려도 동작한다(이전 코드는 이 열을 읽지 않는다).
-- 되돌리기: rollbacks/192_user_login_lockout_rollback.sql

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

COMMENT ON COLUMN users.failed_login_count IS
    '연속 로그인 실패 횟수 — 성공 시 0 으로 초기화(W3 S7, 2026-10-23)';
COMMENT ON COLUMN users.locked_until IS
    '이 시각까지 로그인 거부 — 실패 횟수가 AUTH_LOCKOUT_THRESHOLD 에 닿으면 NOW() + AUTH_LOCKOUT_MS(W3 S7, 2026-10-23)';
