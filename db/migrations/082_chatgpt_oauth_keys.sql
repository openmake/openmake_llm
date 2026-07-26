-- 082: ChatGPT OAuth (디바이스 플로우) — user_external_api_keys 인증방식 확장
--
-- auth_method='oauth' 행은 encrypted_key 에 API 키 대신 OAuth 세션 JSON
-- ({accessToken, refreshToken, accountId, expiresAt})을 AES-256-GCM 암호화하여 저장.
-- 만료 시각·계정 ID 는 복호화 없이 조회할 수 있도록 별도 컬럼으로 병행 보관.

ALTER TABLE user_external_api_keys
    ADD COLUMN IF NOT EXISTS auth_method VARCHAR(16) NOT NULL DEFAULT 'api_key',
    ADD COLUMN IF NOT EXISTS oauth_account_id TEXT,
    ADD COLUMN IF NOT EXISTS oauth_expires_at TIMESTAMPTZ;

DO $$ BEGIN
    ALTER TABLE user_external_api_keys
        ADD CONSTRAINT user_external_api_keys_auth_method_chk
        CHECK (auth_method IN ('api_key', 'oauth'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
