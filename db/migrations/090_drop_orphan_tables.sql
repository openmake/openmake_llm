-- ============================================================
-- 090: 고아 테이블 최종 제거 (코드 참조 0 · 전 테이블 0행 확인, 2026-08-08)
-- ============================================================
--
-- 대상 (apps/ 전체 grep 참조 0건 + 운영 DB 0행 실측):
--   canvas_versions / canvas_documents          — 미구현 canvas 기능 스키마 잔재
--   agent_reviews / agent_installations / agent_marketplace — 미구현 마켓플레이스 잔재
--   uir_shadow_log / uir_rollout_config / uir_perf_stats    — UIR 폐기 잔재 (017 이 DROP)
--   uploaded_documents                          — RAG 폐기 잔재 (046 이 DROP)
--
-- ⚠️ uir_* · uploaded_documents 는 017/046 이 이미 DROP 했으나, 부팅 baseline
--    (db/init/002-schema.sql)에 CREATE IF NOT EXISTS 가 남아 매 부팅 빈 테이블로
--    재생성되던 결함이 있었다. 이번 PR 에서 baseline 의 CREATE 도 함께 제거했으므로
--    이 DROP 이후 재생성되지 않는다. (교훈: 테이블 폐기는 DROP 마이그레이션 +
--    baseline CREATE 제거를 반드시 한 쌍으로.)
--
-- 안전성:
--   - FK 는 전부 고아 테이블 → 라이브 테이블(users/custom_agents/conversation_sessions)
--     방향 — 라이브 테이블이 고아 테이블을 참조하는 역방향 0건 확인.
--   - 자식(참조하는 쪽) 먼저 DROP. IF EXISTS 로 재실행/부재 안전.
-- ============================================================

DROP TABLE IF EXISTS agent_reviews CASCADE;
DROP TABLE IF EXISTS agent_installations CASCADE;
DROP TABLE IF EXISTS agent_marketplace CASCADE;
DROP TABLE IF EXISTS canvas_versions CASCADE;
DROP TABLE IF EXISTS canvas_documents CASCADE;
DROP TABLE IF EXISTS uir_shadow_log CASCADE;
DROP TABLE IF EXISTS uir_rollout_config CASCADE;
DROP TABLE IF EXISTS uir_perf_stats CASCADE;
DROP TABLE IF EXISTS uploaded_documents CASCADE;
