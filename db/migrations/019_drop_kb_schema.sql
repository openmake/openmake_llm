-- ============================================================
-- 019_drop_kb_schema.sql — Knowledge Base 스키마 정리
-- ============================================================
--
-- KB(Knowledge Base) 코드(kb.routes.ts, kb-repository.ts)는 2026-05-19 에
-- 제거됐다. 메타데이터 CRUD API 만 노출됐을 뿐 채팅 파이프라인 / RAG / 검색
-- 어디에도 연결되지 않은 dead 인프라였다.
--
-- 운영 DB 에 016_external_provider_integration.sql 의 일부로 생성된
-- 2개 테이블이 잔존하므로 cleanup 마이그레이션을 추가한다.
--
-- 신규 환경: 016 적용 후 곧장 019 적용 → 테이블 생성 후 즉시 삭제 (무해).
-- 운영 환경: 019 만 적용 → 잔존 KB 테이블 정리.
--
-- 안전성:
--   - DROP TABLE IF EXISTS → 테이블 부재 시 no-op
--   - 운영 데이터: 본 마이그레이션 작성 시점 (2026-05-19) row count = 0/0 확인됨
--   - FK 의존성: knowledge_collection_documents → knowledge_collections 순으로 drop
--   - 코드 베이스에서 두 테이블 참조 0건 (kb-repository 제거 완료 시점 검증)
--   - migration_versions 등록은 runner.ts 가 자동 처리
--
-- 복구 (필요 시): RAG 재도입 시 신규 스키마 설계 권장 (이전 KB 메타 구조는
-- 검색/주입 없이 메타데이터만 추적했기에 RAG 인프라에 그대로 재사용 부적합).
--
-- @see commits 2026-05-19 (KB 코드 제거)
-- ============================================================

DROP TABLE IF EXISTS knowledge_collection_documents;
DROP TABLE IF EXISTS knowledge_collections;
