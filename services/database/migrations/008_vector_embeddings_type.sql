-- ============================================================
-- Migration 008: vector_embeddings.embedding 타입 변환
-- ============================================================
--
-- 목적: vector_embeddings 테이블의 embedding 컬럼을 TEXT에서 vector(768)로 변환합니다.
--       pgvector 확장이 설치된 경우에만 변환하며, 미설치 시 TEXT를 유지합니다(graceful degradation).
--
-- 전제 조건: pgvector 확장 설치 필요 (선택적)
--   CREATE EXTENSION IF NOT EXISTS vector;
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/008_vector_embeddings_type.sql
--
-- 롤백:
--   ALTER TABLE vector_embeddings ALTER COLUMN embedding TYPE TEXT USING embedding::text;
--   DELETE FROM migration_versions WHERE version = '008';
--
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('008', '008_vector_embeddings_type.sql')
ON CONFLICT (version) DO NOTHING;

-- pgvector 확장이 설치된 경우에만 embedding 컬럼을 vector(768)로 변환
-- 미설치 시 TEXT 유지 (graceful degradation)
DO $$
DECLARE
    pgvector_available BOOLEAN;
    current_col_type TEXT;
BEGIN
    -- pgvector 확장 설치 여부 확인
    SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) INTO pgvector_available;

    IF NOT pgvector_available THEN
        RAISE NOTICE '[Migration 008] pgvector 확장이 설치되지 않았습니다. embedding 컬럼을 TEXT로 유지합니다.';
        RETURN;
    END IF;

    -- 현재 컬럼 타입 확인
    SELECT data_type INTO current_col_type
    FROM information_schema.columns
    WHERE table_name = 'vector_embeddings'
      AND column_name = 'embedding';

    IF current_col_type IS NULL THEN
        RAISE NOTICE '[Migration 008] vector_embeddings 테이블 또는 embedding 컬럼이 존재하지 않습니다. 건너뜁니다.';
        RETURN;
    END IF;

    -- 이미 vector 타입인 경우 건너뜀
    IF current_col_type = 'USER-DEFINED' THEN
        RAISE NOTICE '[Migration 008] embedding 컬럼이 이미 vector 타입입니다. 건너뜁니다.';
        RETURN;
    END IF;

    -- TEXT → vector(768) 변환
    -- 기존 데이터가 없거나 올바른 형식인 경우 변환 수행
    RAISE NOTICE '[Migration 008] pgvector 확장 감지됨. embedding 컬럼을 TEXT에서 vector(768)로 변환합니다.';
    ALTER TABLE vector_embeddings ALTER COLUMN embedding TYPE vector(768) USING embedding::vector;
    RAISE NOTICE '[Migration 008] embedding 컬럼 타입 변환 완료: TEXT → vector(768)';
END $$;

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT column_name, data_type, udt_name
-- FROM information_schema.columns
-- WHERE table_name = 'vector_embeddings' AND column_name = 'embedding';
