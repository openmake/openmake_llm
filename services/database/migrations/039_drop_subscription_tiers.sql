-- 039_drop_subscription_tiers.sql
-- 구독 플랜(tier) 시스템 전면 제거 — 모든 이용자가 모든 기능을 제한 없이 사용.
--
-- 애플리케이션 코드에서 tier 타입/상수/게이팅을 모두 제거한 뒤의 후속 스키마 정리.
-- 멱등(idempotent) 작성: DROP COLUMN IF EXISTS / DROP INDEX IF EXISTS 로 재실행 안전.
--
-- ⚠️ user_api_keys.rate_limit_tier 는 의도적으로 보존한다.
--    이 컬럼은 구독 등급이 아니라 개발자 API Key 의 RPM/TPM 남용 방지 rate-limiter
--    (middlewares/api-key-limiter.ts, API_KEY_TIER_LIMITS)가 사용하는 별개 도메인이며,
--    CLAUDE.md 의 "남용 방지 rate-limit 미들웨어는 건드리지 말 것" 원칙에 따라 유지한다.
--
-- 자동 적용되지 않음(수동 CLI): npx ts-node backend/api/src/data/migrations/cli.ts migrate

-- ── 1. users.tier 제거 (구독 등급) ──
ALTER TABLE users DROP COLUMN IF EXISTS tier;

-- ── 2. mcp_server_catalog.required_tier 제거 (카탈로그 등급 게이트) ──
-- 023 에서 만든 부분 인덱스도 함께 제거. (DROP COLUMN 이 의존 인덱스를 자동 제거하지만 멱등 명시)
DROP INDEX IF EXISTS idx_mcp_catalog_tier;
ALTER TABLE mcp_server_catalog DROP COLUMN IF EXISTS required_tier;
