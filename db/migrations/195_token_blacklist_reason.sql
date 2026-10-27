-- Migration 195 — 토큰 블랙리스트 폐기 사유 (2026-10-25, 보안 점검 A7)
--
-- 'rotated' = refresh 회전으로 폐기된 옛 refresh(다시 제시되면 재사용 = 탈취 신호 → 그 사용자 토큰 전체 무효화),
-- 'revoked' = 그 밖(로그아웃·세션 상한 정리·비밀번호 변경) — 거부만 하고 무효화하지 않는다.
-- 기본 'revoked' — 기존 행은 재사용 탐지 대상이 아니다(오탐 없음).
-- 코드: apps/api/src/data/models/token-blacklist.ts(add·getReason), apps/api/src/auth/auth-core.ts(verifyRefreshToken·blacklistToken),
--       apps/api/src/controllers/auth.controller.ts(refresh 회전 'rotated')
--
-- token_blacklist 는 모델이 lazy CREATE 하므로 이 마이그레이션 시점에 없을 수 있다 — 먼저 같은 정의로 보장한다.
-- additive 만 — 열 추가. 멱등(IF NOT EXISTS). 코드만 되돌려도 동작한다(이전 코드는 이 열을 읽지 않고, 기본값이 INSERT 를 채운다).
-- 되돌리기: rollbacks/195_token_blacklist_reason_rollback.sql

CREATE TABLE IF NOT EXISTS token_blacklist (
    jti TEXT PRIMARY KEY,
    expires_at BIGINT NOT NULL,
    created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)
);

ALTER TABLE token_blacklist ADD COLUMN IF NOT EXISTS reason TEXT NOT NULL DEFAULT 'revoked';

COMMENT ON COLUMN token_blacklist.reason IS
    '폐기 사유 — rotated(refresh 회전, 재사용 탐지 대상) / revoked(그 밖) (보안 점검 A7, 2026-10-25)';
