-- ============================================================
-- Migration 002: vector_embeddings TEXT → vector(768) 강제 전환
-- ============================================================
--
-- 목적: embedding 컬럼을 TEXT 폴백에서 실제 vector(768) 타입으로 변환합니다.
-- pgvector 확장이 설치되어 있어야 합니다.
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/002_vector_type_migration.sql
--
-- 사전 요구:
--   1. pgvector 확장 설치 (CREATE EXTENSION IF NOT EXISTS vector;)
--   2. 데이터베이스 백업 권장
--
-- 롤백:
--   ALTER TABLE vector_embeddings ALTER COLUMN embedding TYPE TEXT;
--
-- @see services/database/init/002-schema.sql (원본 스키마)
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('002', '002_vector_type_migration.sql')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
    -- 1. pgvector 확장 확인 — 미설치 시 즉시 중단
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RAISE EXCEPTION '[Migration 002] pgvector 확장이 설치되어 있지 않습니다. CREATE EXTENSION vector; 실행 후 재시도하세요.';
    END IF;

    -- 2. 현재 embedding 컬럼 타입 확인
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'vector_embeddings'
          AND column_name = 'embedding'
          AND data_type = 'text'
    ) THEN
        -- 3. TEXT → vector(768) 변환
        RAISE NOTICE '[Migration 002] embedding 컬럼을 TEXT → vector(768)로 변환 시작...';

        ALTER TABLE vector_embeddings
            ALTER COLUMN embedding TYPE vector(768)
            USING CASE
                WHEN embedding IS NULL OR embedding = '' THEN NULL
                ELSE embedding::vector
            END;

        RAISE NOTICE '[Migration 002] vector(768) 타입 전환 완료';
    ELSE
        RAISE NOTICE '[Migration 002] embedding 컬럼이 이미 vector 타입입니다. 스킵합니다.';
    END IF;

    -- 4. 기존 IVFFlat 인덱스 확인 (존재하면 유지, HNSW 전환은 Phase 2 W3에서 수행)
    IF EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE tablename = 'vector_embeddings'
          AND indexname LIKE '%embedding%'
    ) THEN
        RAISE NOTICE '[Migration 002] 기존 벡터 인덱스 확인됨 — 유지합니다 (HNSW 전환은 Phase 2 W3)';
    ELSE
        -- IVFFlat 인덱스 생성 (아직 없는 경우)
        CREATE INDEX IF NOT EXISTS idx_vector_embeddings_embedding
            ON vector_embeddings USING ivfflat (embedding vector_cosine_ops)
            WITH (lists = 100);
        RAISE NOTICE '[Migration 002] IVFFlat 인덱스 생성 완료 (lists=100)';
    END IF;

    -- 5. NOT NULL 제약 추가 (NULL 임베딩 방지)
    -- 주의: 기존 NULL 데이터가 있으면 실패합니다.
    -- 필요 시 먼저: DELETE FROM vector_embeddings WHERE embedding IS NULL;
    -- ALTER TABLE vector_embeddings ALTER COLUMN embedding SET NOT NULL;
    -- ↑ 주석 처리: 기존 데이터 호환성을 위해 NOT NULL은 선택사항으로 남깁니다.

END $$;

-- 검증 쿼리 (수동 실행)
-- SELECT pg_typeof(embedding) FROM vector_embeddings LIMIT 1;
-- 결과가 'vector'이면 성공
