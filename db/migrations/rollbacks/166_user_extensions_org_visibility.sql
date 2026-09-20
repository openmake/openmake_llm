-- Rollback 166 — 조직 공개 행은 비공개로 되돌린 뒤 제약·컬럼을 걷는다
UPDATE user_extensions SET visibility = 'private' WHERE visibility = 'organization';
DROP INDEX IF EXISTS idx_user_extensions_org;
ALTER TABLE user_extensions DROP CONSTRAINT IF EXISTS user_extensions_visibility_chk;
ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_visibility_chk CHECK (visibility IN ('private', 'shared'));
ALTER TABLE user_extensions DROP COLUMN IF EXISTS org_id;
