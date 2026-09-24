-- Knowledge Space (knowledge-runtime add-on, 2026-09-24) — 문서 기반 작업공간 스키마
--
-- 사용자 확정 결정: 범용 projects 가 아니라 Knowledge 전용 도메인. 대화와는 conversation binding 으로만 연결.
-- 벡터 저장소는 pgvector — 임베딩 차원은 컬럼 타입이 아니라 knowledge_embedding_indexes 행이 기록한다
-- (모델을 바꾸면 새 index 를 만들고 원자 전환한다). 정책값(청크 크기·top-K·한도)은 knowledge_profiles 의 데이터다.

CREATE EXTENSION IF NOT EXISTS vector;

-- 정책 프로필 — kind 별 설정 묶음. 코드는 이름으로 참조만 하고 값은 여기서 읽는다.
CREATE TABLE IF NOT EXISTS knowledge_profiles (
    id          TEXT PRIMARY KEY,
    kind        VARCHAR(20) NOT NULL,          -- space | chunker | retrieval | limits
    name        TEXT NOT NULL,
    config      JSONB NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_profiles_default ON knowledge_profiles(kind) WHERE is_default;

INSERT INTO knowledge_profiles (id, kind, name, config, is_default) VALUES
    ('chunker-default',   'chunker',   'default', '{"strategy":"fixed-token","size":512,"overlap":64}', TRUE),
    ('retrieval-default', 'retrieval', 'default', '{"topK":6,"candidateCount":24,"minSimilarity":0.3,"maxContextChars":12000,"maxTopK":12}', TRUE),
    ('limits-default',    'limits',    'default', '{"maxFileBytes":52428800,"maxDocumentsPerSpace":200,"maxSpacesPerScope":50,"allowedMimeTypes":["application/pdf","text/plain","text/markdown"],"purgeAfterDays":30,"minCharsPerPdfPage":20,"embedBatchSize":32,"ingestConcurrency":1,"jobLeaseMs":120000,"jobMaxAttempts":3,"orgWriteRoles":["owner","admin"]}', TRUE),
    ('space-default',     'space',     'default', '{"chunker":"chunker-default","retrieval":"retrieval-default","limits":"limits-default"}', TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS knowledge_spaces (
    id                 TEXT PRIMARY KEY,
    scope_type         VARCHAR(20) NOT NULL,   -- user | organization (권한 규칙은 코드의 scope 정책 표)
    scope_id           TEXT NOT NULL,
    created_by         TEXT NOT NULL,
    name               TEXT NOT NULL,
    description        TEXT,
    icon               VARCHAR(32),
    status             VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | deleting | tombstoned | purged
    config_profile_id  TEXT REFERENCES knowledge_profiles(id),
    last_used_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_knowledge_spaces_scope ON knowledge_spaces(scope_type, scope_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_documents (
    id                  TEXT PRIMARY KEY,
    space_id            TEXT NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    logical_name        TEXT NOT NULL,
    current_version_id  TEXT,
    source_type         VARCHAR(20) NOT NULL DEFAULT 'upload',
    status              VARCHAR(20) NOT NULL DEFAULT 'processing',  -- processing | ready | failed | deleted
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_space ON knowledge_documents(space_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_document_versions (
    id                  TEXT PRIMARY KEY,
    document_id         TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    content_hash        CHAR(64) NOT NULL,       -- sha256(원본 바이트) — 파일명으로 중복 판정하지 않는다
    mime_type           TEXT NOT NULL,
    original_filename   TEXT NOT NULL,
    storage_ref         TEXT NOT NULL,
    source_size         BIGINT NOT NULL,
    parser_id           TEXT,
    parser_version      TEXT,
    chunker_profile_id  TEXT REFERENCES knowledge_profiles(id),
    extracted_chars     INTEGER,
    page_count          INTEGER,
    -- uploaded → validating → extracting → chunking → embedding → verifying → ready | failed
    status              VARCHAR(20) NOT NULL DEFAULT 'uploaded',
    failure_code        VARCHAR(60),             -- FAILED_VALIDATION | SCANNED_PDF_UNSUPPORTED | FAILED_EXTRACTION | FAILED_EMBEDDING …
    progress            SMALLINT NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_versions_document ON knowledge_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_versions_hash ON knowledge_document_versions(content_hash);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id                   TEXT PRIMARY KEY,
    document_version_id  TEXT NOT NULL REFERENCES knowledge_document_versions(id) ON DELETE CASCADE,
    sequence             INTEGER NOT NULL,
    content              TEXT NOT NULL,
    content_hash         CHAR(64) NOT NULL,
    token_count          INTEGER NOT NULL,
    page_start           INTEGER,
    page_end             INTEGER,
    char_start           INTEGER NOT NULL,
    char_end             INTEGER NOT NULL,
    heading_path         TEXT,
    metadata             JSONB,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_version_id, sequence)    -- 재시도·재시작에도 같은 청크가 두 번 생기지 않는다
);

CREATE TABLE IF NOT EXISTS knowledge_embedding_indexes (
    id               TEXT PRIMARY KEY,
    provider_ref     TEXT NOT NULL,            -- 해석된 capability 배정(예: provider:model) — 표시·감사용
    model_id         TEXT NOT NULL,
    model_revision   TEXT,
    dimension        INTEGER NOT NULL,         -- provider 응답으로 측정한 값
    distance_metric  VARCHAR(20) NOT NULL,     -- cosine | l2 | inner_product
    status           VARCHAR(20) NOT NULL DEFAULT 'building',  -- building | ready | retired
    is_active        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at     TIMESTAMPTZ,
    retired_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_knowledge_embedding_index_active ON knowledge_embedding_indexes(is_active) WHERE is_active;

CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
    id                  TEXT PRIMARY KEY,
    chunk_id            TEXT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
    embedding_index_id  TEXT NOT NULL REFERENCES knowledge_embedding_indexes(id) ON DELETE CASCADE,
    embedding           vector NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chunk_id, embedding_index_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_index ON knowledge_chunk_embeddings(embedding_index_id);

-- 대화 ↔ Space 연결 — 채팅 턴의 권한 근거(클라이언트 값이 아니다). 대화가 지워지면 연결도 사라진다.
CREATE TABLE IF NOT EXISTS knowledge_conversation_bindings (
    session_id  TEXT PRIMARY KEY REFERENCES conversation_sessions(id) ON DELETE CASCADE,
    space_id    TEXT NOT NULL REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    bound_by    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_bindings_space ON knowledge_conversation_bindings(space_id);

CREATE TABLE IF NOT EXISTS knowledge_ingestion_jobs (
    id                   TEXT PRIMARY KEY,
    kind                 VARCHAR(20) NOT NULL,   -- ingest | reindex | rechunk | cleanup
    document_version_id  TEXT REFERENCES knowledge_document_versions(id) ON DELETE CASCADE,
    space_id             TEXT REFERENCES knowledge_spaces(id) ON DELETE CASCADE,
    embedding_index_id   TEXT REFERENCES knowledge_embedding_indexes(id) ON DELETE CASCADE,
    state                VARCHAR(20) NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
    attempts             INTEGER NOT NULL DEFAULT 0,
    lease_owner          TEXT,
    lease_expires_at     TIMESTAMPTZ,
    fencing_token        BIGINT NOT NULL DEFAULT 0,
    last_error           TEXT,
    run_after            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_knowledge_jobs_due ON knowledge_ingestion_jobs(run_after) WHERE state IN ('queued', 'running');
