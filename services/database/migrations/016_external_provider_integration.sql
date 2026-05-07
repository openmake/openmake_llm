-- ============================================================
-- 016_external_provider_integration.sql
-- ============================================================
-- 외부 LLM provider(Anthropic, OpenAI 호환 endpoint 등) BYO Key 통합.
--
-- 3개 테이블:
--   1. user_external_api_keys     — 사용자별 암호화 API 키 저장 (AES-256-GCM, token-crypto.ts 재사용)
--   2. external_provider_usage    — 호출별 토큰/비용 사용량 (90일 보존)
--   3. external_provider_models_cache — provider /v1/models 응답 캐시 (TTL 1h)
--
-- 암호화 정책:
--   - encrypted_key 컬럼은 utils/token-crypto.ts 의 'v1:iv:ct:tag' 단일 문자열 포맷 사용
--   - TOKEN_ENCRYPTION_KEY 환경변수 재사용 (별도 마스터 키 도입 안 함)
--   - DB 직접 조회로는 평문 노출 불가, 애플리케이션 레벨에서만 복호화
--
-- 게스트 정책:
--   - 외부 provider는 로그인 사용자 전용 — provider-router.ts 에서 GUEST_NOT_ALLOWED 반환
--   - users(id)는 TEXT 타입 (기존 패턴 일치)
--
-- @see backend/api/src/utils/token-crypto.ts (encryptToken/decryptToken)
-- @see backend/api/src/providers/provider-router.ts (게스트 가드)
-- @see docs/superpowers/specs/2026-05-07-external-llm-integration-design.md (§5)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_external_api_keys (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL,
    sdk_type VARCHAR(32) NOT NULL
        CHECK (sdk_type IN ('anthropic', 'openai-compatible')),
    display_name VARCHAR(128) NOT NULL,
    base_url TEXT,
    encrypted_key TEXT NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_validated_at TIMESTAMPTZ,
    last_validation_ok BOOLEAN,
    last_validation_error TEXT,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_user_ext_keys_user
    ON user_external_api_keys (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_user_ext_keys_invalid
    ON user_external_api_keys (last_validated_at)
    WHERE last_validation_ok = FALSE;

COMMENT ON TABLE user_external_api_keys IS
    '사용자별 외부 LLM provider BYO API 키 — token-crypto.ts AES-256-GCM 암호화';
COMMENT ON COLUMN user_external_api_keys.encrypted_key IS
    'token-crypto.ts encryptToken() 출력 (v1:iv:ct:tag 단일 문자열)';
COMMENT ON COLUMN user_external_api_keys.key_prefix IS
    'UI 표시용 키 prefix (예: sk-ant-test-...) — 평문 노출 금지';
COMMENT ON COLUMN user_external_api_keys.last_validation_ok IS
    'NULL=미검증, TRUE=직전 검증 성공, FALSE=실패 (idx_user_ext_keys_invalid 부분 인덱스 대상)';

CREATE TABLE IF NOT EXISTS external_provider_usage (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL,
    model_id VARCHAR(128) NOT NULL,
    request_id UUID,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    thinking_tokens INTEGER,
    cost_usd_micros BIGINT NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    finish_reason VARCHAR(32),
    error_code VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_ext_usage_user_date
    ON external_provider_usage (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ext_usage_user_provider
    ON external_provider_usage (user_id, provider_id, occurred_at DESC);

COMMENT ON TABLE external_provider_usage IS
    '외부 provider 호출별 토큰/비용 사용량 — 90일 보존 (cleanup cron 별도)';
COMMENT ON COLUMN external_provider_usage.cost_usd_micros IS
    '1 USD = 1,000,000 micros — 부동소수 누적 오차 방지';
COMMENT ON COLUMN external_provider_usage.thinking_tokens IS
    'Anthropic extended thinking 토큰 — 미지원 provider 는 NULL';

CREATE TABLE IF NOT EXISTS external_provider_models_cache (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider_id VARCHAR(64) NOT NULL,
    cached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    models_json JSONB NOT NULL,
    PRIMARY KEY (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_ext_models_cache_stale
    ON external_provider_models_cache (cached_at);

COMMENT ON TABLE external_provider_models_cache IS
    '외부 provider /v1/models 응답 캐시 — TTL 1h (EXTERNAL_MODELS_CACHE_TTL_MS)';
