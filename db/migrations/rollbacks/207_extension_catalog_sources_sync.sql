-- 207 되돌리기 — 코드 참조(alias·credential_encrypted·source_subpath·sync_*)를 먼저 걷어낸 뒤 실행한다.
-- ⚠️ 저장된 원본 접근 토큰(credential_encrypted)이 함께 지워진다.
ALTER TABLE extension_catalog_sources DROP CONSTRAINT IF EXISTS extension_catalog_sources_sync_status_check;
ALTER TABLE extension_catalog_sources DROP CONSTRAINT IF EXISTS extension_catalog_sources_alias_key;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS last_sync_attempt_at;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS last_sync_error;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS sync_status;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS index_url;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS source_subpath;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS credential_encrypted;
ALTER TABLE extension_catalog_sources DROP COLUMN IF EXISTS alias;
