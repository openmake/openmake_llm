-- Rollback 212 — 조직 소유 행(user_id NULL)은 사람 소유자가 없어 되돌릴 곳이 없다 → 지운 뒤 제약·컬럼을 걷고 NOT NULL 복원
DELETE FROM user_extensions WHERE owner_org_id IS NOT NULL;
DROP INDEX IF EXISTS uq_user_extensions_org_owned_active_name;
ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_org_owned_visibility_chk;
ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_owner_chk;
ALTER TABLE user_extensions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE user_extensions DROP COLUMN IF EXISTS installed_by_user_id;
ALTER TABLE user_extensions DROP COLUMN IF EXISTS owner_org_id;
