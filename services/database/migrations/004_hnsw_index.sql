-- ============================================================
-- Migration 004: IVFFlat → HNSW 인덱스 전환
-- ============================================================
--
-- 목적: vector_embeddings의 벡터 인덱스를 IVFFlat에서 HNSW로 전환합니다.
--       HNSW는 데이터 삽입 후 재빌드가 불필요하며, 검색 정확도가 높습니다.
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/004_hnsw_index.sql
--
-- 사전 요구:
--   1. pgvector 확장 설치 (CREATE EXTENSION IF NOT EXISTS vector;)
--   2. 데이터베이스 백업 권장
--   3. 충분한 메모리 확인 (500K 벡터 × 768 dim ≈ 3GB 피크)
--
-- 설정 근거 (M4 Mac mini 16GB):
--   m = 16          : 그래프 연결 수 (기본 16, 메모리 효율적)
--   ef_construction = 64 : 빌드 시 탐색 깊이 (품질↑ = 빌드 시간↑)
--   SET hnsw.ef_search = 40 : 쿼리 시 탐색 깊이 (런타임에서 조절 가능)
--
-- 롤백:
--   DROP INDEX IF EXISTS idx_embeddings_hnsw;
--   CREATE INDEX idx_embeddings_vector ON vector_embeddings
--       USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--   DELETE FROM migration_versions WHERE version = '004';
--
-- @see DEVELOPMENT_PLAN.md Phase 2 Week 3
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('004', '004_hnsw_index.sql')
ON CONFLICT (version) DO NOTHING;

DO $$
BEGIN
    -- 1. pgvector 확장 확인
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        RAISE EXCEPTION '[Migration 004] pgvector 확장이 설치되어 있지 않습니다.';
    END IF;

    -- 2. vector_embeddings 테이블 존재 확인
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'vector_embeddings'
    ) THEN
        RAISE EXCEPTION '[Migration 004] vector_embeddings 테이블이 존재하지 않습니다.';
    END IF;

    -- 3. 기존 IVFFlat 인덱스 삭제
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'vector_embeddings'
          AND indexname = 'idx_embeddings_vector'
    ) THEN
        DROP INDEX idx_embeddings_vector;
        RAISE NOTICE '[Migration 004] 기존 IVFFlat 인덱스 idx_embeddings_vector 삭제 완료';
    END IF;

    -- Migration 002에서 생성된 인덱스도 삭제
    IF EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'vector_embeddings'
          AND indexname = 'idx_vector_embeddings_embedding'
    ) THEN
        DROP INDEX idx_vector_embeddings_embedding;
        RAISE NOTICE '[Migration 004] 기존 IVFFlat 인덱스 idx_vector_embeddings_embedding 삭제 완료';
    END IF;

    -- 4. HNSW 인덱스 생성
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE tablename = 'vector_embeddings'
          AND indexname = 'idx_embeddings_hnsw'
    ) THEN
        CREATE INDEX idx_embeddings_hnsw
            ON vector_embeddings USING hnsw (embedding vector_cosine_ops)
            WITH (m = 16, ef_construction = 64);
        RAISE NOTICE '[Migration 004] HNSW 인덱스 idx_embeddings_hnsw 생성 완료 (m=16, ef_construction=64)';
    ELSE
        RAISE NOTICE '[Migration 004] HNSW 인덱스 이미 존재 — 스킵';
    END IF;

END $$;

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- HNSW 인덱스 존재 확인:
--   SELECT indexname, indexdef FROM pg_indexes
--   WHERE tablename = 'vector_embeddings' AND indexname LIKE '%hnsw%';
--
-- 검색 시 HNSW 인덱스 사용 확인 (EXPLAIN):
--   EXPLAIN ANALYZE
--   SELECT id, 1 - (embedding <=> '[0.1,0.2,...]'::vector) as similarity
--   FROM vector_embeddings
--   ORDER BY embedding <=> '[0.1,0.2,...]'::vector
--   LIMIT 5;
