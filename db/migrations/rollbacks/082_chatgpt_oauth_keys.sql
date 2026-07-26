-- 082 rollback: ChatGPT OAuth 컬럼 제거
ALTER TABLE user_external_api_keys
    DROP CONSTRAINT IF EXISTS user_external_api_keys_auth_method_chk;
ALTER TABLE user_external_api_keys
    DROP COLUMN IF EXISTS auth_method,
    DROP COLUMN IF EXISTS oauth_account_id,
    DROP COLUMN IF EXISTS oauth_expires_at;
