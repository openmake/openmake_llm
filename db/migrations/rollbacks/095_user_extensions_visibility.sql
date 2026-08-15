-- Rollback 095 — visibility 제거
--
-- ⚠️ 애플리케이션 코드 참조 제거 후 실행할 것 (2단계 배포 원칙).

DROP INDEX IF EXISTS idx_user_extensions_shared;
ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_visibility_chk;
ALTER TABLE user_extensions DROP COLUMN IF EXISTS visibility;
