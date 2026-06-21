-- ============================================================
-- 017_drop_uir_schema.sql — UIR(Unified Intent Router) 스키마 정리
-- ============================================================
--
-- UIR 본체 코드는 Stage 3a-uir / 3a-uir-cleanup 에서 통째로 제거됐다
-- (commits 42d4df5, 7d6beb2). 운영 DB 에 012_uir_schema.sql 로 생성된
-- 3개 테이블이 잔존하므로 cleanup 마이그레이션을 추가한다.
--
-- 신규 환경: 012 적용 후 곧장 017 적용 → 테이블 생성 후 즉시 삭제 (무해).
-- 운영 환경: 017 만 적용 → 잔존 UIR 테이블 정리.
--
-- 안전성:
--   - DROP TABLE IF EXISTS → 테이블 부재 시 no-op
--   - 코드 베이스에서 uir_shadow_log / uir_rollout_config / uir_perf_stats
--     테이블에 대한 참조는 0건 (Stage 3a-uir 시점 검증)
--   - migration_versions 등록은 runner.ts 가 자동 처리
--
-- 복구 (필요 시): 012_uir_schema.sql 을 다시 실행하면 빈 스키마로 재생성.
-- 단 적재돼있던 shadow log / rollout history 는 영구 손실됨.
--
-- @see commits 42d4df5 (UIR 본체 삭제) + 7d6beb2 (인프라 정리)
-- ============================================================

DROP TABLE IF EXISTS uir_shadow_log;
DROP TABLE IF EXISTS uir_rollout_config;
DROP TABLE IF EXISTS uir_perf_stats;
