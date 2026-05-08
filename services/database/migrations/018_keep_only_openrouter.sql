-- ============================================================================
-- 018_keep_only_openrouter.sql
-- ============================================================================
-- 외부 provider 카탈로그 축소 — OpenRouter 외 행 일괄 삭제 (2026-05-08).
--
-- spec: docs/superpowers/specs/2026-05-08-move-model-selector-to-settings-design.md
--
-- 영향 테이블:
--   - user_external_api_keys     (provider_id != 'openrouter' 사용자 키 삭제)
--   - external_provider_models_cache (해당 provider 캐시 삭제)
--   - external_provider_usage    (해당 provider 사용량 로그 삭제)
--
-- 스키마는 그대로 유지 — DB CHECK (sdk_type IN ('anthropic', 'openai-compatible'))
-- 도 그대로. 향후 provider 재도입 시 재사용 가능.
--
-- Idempotent: 재실행 시 0/0/0 행 삭제 (이미 삭제된 상태).
--
-- 트랜잭션: 별도 BEGIN/COMMIT 없음 — MigrationRunner.applyPending() 가
-- 자동으로 BEGIN/COMMIT/ROLLBACK 으로 wrap (runner.ts:77-87).
--
-- !! 운영 DB 적용 전 반드시 pg_dump 백업.
-- ============================================================================

DO $$
DECLARE
    deleted_keys INT;
    deleted_cache INT;
    deleted_usage INT;
BEGIN
    DELETE FROM user_external_api_keys WHERE provider_id <> 'openrouter';
    GET DIAGNOSTICS deleted_keys = ROW_COUNT;

    DELETE FROM external_provider_models_cache WHERE provider_id <> 'openrouter';
    GET DIAGNOSTICS deleted_cache = ROW_COUNT;

    DELETE FROM external_provider_usage WHERE provider_id <> 'openrouter';
    GET DIAGNOSTICS deleted_usage = ROW_COUNT;

    RAISE NOTICE '[018] removed legacy provider data: % keys, % cache rows, % usage rows',
        deleted_keys, deleted_cache, deleted_usage;
END$$;
