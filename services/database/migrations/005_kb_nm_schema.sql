-- ============================================================
-- Migration 005: N:M Knowledge Base (컬렉션 ↔ 문서)
-- ============================================================
--
-- 목적: 문서를 여러 컬렉션에 동시 소속시킬 수 있는 N:M 관계를 구축합니다.
--       컬렉션 삭제 시 매핑만 삭제되고, 문서/임베딩은 보존됩니다.
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/005_kb_nm_schema.sql
--
-- 롤백:
--   DROP TABLE IF EXISTS knowledge_collection_documents;
--   DROP TABLE IF EXISTS knowledge_collections;
--   DELETE FROM migration_versions WHERE version = '005';
--
-- @see DEVELOPMENT_PLAN.md Phase 2 Week 4
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('005', '005_kb_nm_schema.sql')
ON CONFLICT (version) DO NOTHING;

-- 1. 지식 컬렉션 테이블
CREATE TABLE IF NOT EXISTS knowledge_collections (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    visibility TEXT NOT NULL DEFAULT 'private'
        CHECK (visibility IN ('private', 'team', 'public')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 컬렉션 ↔ 문서 연결 테이블 (N:M)
--    컬렉션 삭제 시 매핑만 CASCADE 삭제, 문서/임베딩은 보존
CREATE TABLE IF NOT EXISTS knowledge_collection_documents (
    collection_id TEXT NOT NULL REFERENCES knowledge_collections(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (collection_id, document_id)
);

-- 3. 인덱스
CREATE INDEX IF NOT EXISTS idx_kb_collections_owner ON knowledge_collections(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_kb_collections_visibility ON knowledge_collections(visibility);
CREATE INDEX IF NOT EXISTS idx_kb_col_docs_collection ON knowledge_collection_documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_kb_col_docs_document ON knowledge_collection_documents(document_id);

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'knowledge_%';
