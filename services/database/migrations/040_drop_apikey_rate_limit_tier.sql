-- 040_drop_apikey_rate_limit_tier.sql
-- 개발자 API Key rate-limit 의 tier 차등(free/starter/standard/enterprise) 제거 —
-- 모든 API 키가 동일한 단일 한도(API_KEY_LIMITS: rpm 300 / tpm 1,000,000 / 일·월 무제한)를 공유한다.
--
-- 구독 플랜 tier 전면 제거(039)의 후속. rate_limit_tier 는 남용 방지 도메인이라 039 에서
-- 보존했으나, 이제 등급 차등 자체를 없애 단일 한도로 통일하므로 컬럼을 제거한다.
-- 멱등(idempotent): DROP INDEX/COLUMN IF EXISTS 로 재실행 안전.
--
-- 자동 적용되지 않음(수동 CLI): npx ts-node backend/api/src/data/migrations/cli.ts migrate

-- tier 기반 인덱스 먼저 제거 (DROP COLUMN 이 의존 인덱스를 자동 제거하지만 멱등 명시)
DROP INDEX IF EXISTS idx_api_keys_tier;

-- rate_limit_tier 컬럼 제거 (limiter 는 이제 단일 API_KEY_LIMITS 적용)
ALTER TABLE user_api_keys DROP COLUMN IF EXISTS rate_limit_tier;
