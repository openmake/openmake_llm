-- Migration 194 — 사용자 토큰 무효화 기준 시각 (2026-10-25, 보안 점검 A2)
--
-- 이 시각 이전에 발급된(JWT iat) 액세스·리프레시 토큰을 거부한다. 비밀번호 변경·권한 승격·refresh 재사용 탐지 때 갱신한다.
-- 기본 NULL — NULL 이면 어떤 토큰도 거부하지 않으므로 기존 토큰은 영향이 없다.
-- 코드: apps/api/src/auth/token-invalidation.ts(판정), apps/api/src/data/user-manager-token-invalidation.ts(갱신),
--       apps/api/src/auth/middleware.ts·controllers/auth.controller.ts(refresh) 검사
--
-- additive 만 — 열 추가. 멱등(IF NOT EXISTS). 코드만 되돌려도 동작한다(이전 코드는 이 열을 읽지 않는다).
-- 되돌리기: rollbacks/194_users_tokens_valid_after_rollback.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS tokens_valid_after TIMESTAMPTZ NULL;

COMMENT ON COLUMN users.tokens_valid_after IS
    '이 시각 이전에 발급된(iat) 토큰 거부 — NULL 이면 검사 안 함(보안 점검 A2, 2026-10-25)';
