-- ============================================================
-- Migration 003: BM25(FTS) 인덱스 + tsvector 컬럼 추가
-- ============================================================
--
-- 목적: vector_embeddings 테이블에 content_tsv (tsvector) 컬럼을 추가하고
--       GIN 인덱스 + 자동 갱신 트리거를 생성합니다.
--       Phase 2 Hybrid Search (Vector + BM25 FTS)의 기반 인프라입니다.
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/003_hybrid_search_fts.sql
--
-- 사전 요구:
--   1. vector_embeddings 테이블 존재
--   2. 데이터베이스 백업 권장
--
-- 롤백:
--   DROP TRIGGER IF EXISTS trg_vector_embeddings_tsv ON vector_embeddings;
--   DROP FUNCTION IF EXISTS vector_embeddings_tsv_trigger();
--   DROP INDEX IF EXISTS idx_embeddings_content_tsv;
--   ALTER TABLE vector_embeddings DROP COLUMN IF EXISTS content_tsv;
--   DELETE FROM migration_versions WHERE version = '003';
--
-- @see DEVELOPMENT_PLAN.md Phase 2 Week 1
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('003', '003_hybrid_search_fts.sql')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
    -- 1. vector_embeddings 테이블 존재 확인
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'vector_embeddings'
    ) THEN
        RAISE EXCEPTION '[Migration 003] vector_embeddings 테이블이 존재하지 않습니다. 스키마를 먼저 생성하세요.';
    END IF;

    -- 2. content_tsv 컬럼 추가 (IF NOT EXISTS로 멱등성 보장)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'vector_embeddings'
          AND column_name = 'content_tsv'
    ) THEN
        ALTER TABLE vector_embeddings ADD COLUMN content_tsv tsvector;
        RAISE NOTICE '[Migration 003] content_tsv 컬럼 추가 완료';

        -- 3. 기존 데이터에 대해 tsvector 값 채우기
        -- 'simple' 설정: 스테밍/불용어 없이 원본 토큰 그대로 인덱싱 (다국어 호환)
        UPDATE vector_embeddings
        SET content_tsv = to_tsvector('simple', coalesce(content, ''));

        RAISE NOTICE '[Migration 003] 기존 행 content_tsv 값 채우기 완료';
    ELSE
        RAISE NOTICE '[Migration 003] content_tsv 컬럼 이미 존재 — 스킵';
    END IF;

    -- 4. GIN 인덱스 생성 (BM25/FTS 검색 가속)
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'vector_embeddings'
          AND indexname = 'idx_embeddings_content_tsv'
    ) THEN
        CREATE INDEX idx_embeddings_content_tsv
            ON vector_embeddings USING GIN (content_tsv);
        RAISE NOTICE '[Migration 003] GIN 인덱스 idx_embeddings_content_tsv 생성 완료';
    ELSE
        RAISE NOTICE '[Migration 003] GIN 인덱스 이미 존재 — 스킵';
    END IF;

    -- 5. 자동 갱신 트리거 함수 생성
    -- INSERT 또는 UPDATE OF content 시 content_tsv를 자동으로 갱신합니다.
    CREATE OR REPLACE FUNCTION vector_embeddings_tsv_trigger()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
        NEW.content_tsv := to_tsvector('simple', coalesce(NEW.content, ''));
        RETURN NEW;
    END $fn$;

    RAISE NOTICE '[Migration 003] 트리거 함수 vector_embeddings_tsv_trigger() 생성 완료';

    -- 6. 트리거 연결 (존재하면 재생성)
    DROP TRIGGER IF EXISTS trg_vector_embeddings_tsv ON vector_embeddings;
    CREATE TRIGGER trg_vector_embeddings_tsv
        BEFORE INSERT OR UPDATE OF content ON vector_embeddings
        FOR EACH ROW EXECUTE FUNCTION vector_embeddings_tsv_trigger();

    RAISE NOTICE '[Migration 003] 트리거 trg_vector_embeddings_tsv 생성 완료';

END $$;

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- 전체 행 수 vs content_tsv IS NOT NULL 확인:
--   SELECT count(*) AS total,
--          count(content_tsv) AS with_tsv
--   FROM vector_embeddings;
--
-- FTS 쿼리 동작 확인:
--   SELECT id, content, ts_rank(content_tsv, q) AS rank
--   FROM vector_embeddings,
--        plainto_tsquery('simple', '검색어') q
--   WHERE content_tsv @@ q
--   ORDER BY rank DESC
--   LIMIT 5;
