-- Rollback 094 — tracking_ref 제거
--
-- ⚠️ 애플리케이션 코드 참조 제거 후 실행할 것 (2단계 배포 원칙).

ALTER TABLE user_extensions DROP COLUMN IF EXISTS tracking_ref;
