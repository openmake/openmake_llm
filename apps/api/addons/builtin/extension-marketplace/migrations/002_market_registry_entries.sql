-- MCP Registry 동기화(M7, 2026-11-28) — 네임스페이스 addon:extension-marketplace:002. 멱등.
--
-- 공식 레지스트리(registry.modelcontextprotocol.io)의 server.json 을 서버 이름(외부 키)마다 최신 판 1행으로 담는다.
-- 레지스트리가 지운 항목은 행을 남기고 tombstoned_at 을 채운다(목록에서 빠진다). 관리자 큐레이션(pending·approved·hidden)과
-- "MCP 카탈로그로 올리기" 결과(promoted_catalog_id)를 함께 둔다. 동기화 진행 상태(커서·기준 시각·백오프)는 원본마다 1행.
-- 사용자 id·토큰·env 값은 저장하지 않는다 — 공개 선언값(원격 주소·패키지·env 이름)만.
CREATE TABLE IF NOT EXISTS market_registry_entries (
    source_id           TEXT NOT NULL,
    server_name         TEXT NOT NULL,
    namespace           TEXT NOT NULL,
    version             TEXT NOT NULL,
    schema_url          TEXT NOT NULL,
    title               TEXT,
    description         TEXT,
    website_url         TEXT,
    repository_url      TEXT,
    remotes             JSONB NOT NULL DEFAULT '[]'::jsonb,
    packages            JSONB NOT NULL DEFAULT '[]'::jsonb,
    registry_status     TEXT NOT NULL CHECK (registry_status IN ('active', 'deprecated', 'deleted')),
    status_message      TEXT,
    published_at        TIMESTAMPTZ,
    registry_updated_at TIMESTAMPTZ,
    tombstoned_at       TIMESTAMPTZ,
    curation            TEXT NOT NULL DEFAULT 'pending' CHECK (curation IN ('pending', 'approved', 'hidden')),
    curated_by          TEXT,
    curated_at          TIMESTAMPTZ,
    promoted_catalog_id TEXT,
    first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source_id, server_name)
);

CREATE INDEX IF NOT EXISTS idx_market_registry_entries_curation
    ON market_registry_entries (source_id, curation, server_name) WHERE tombstoned_at IS NULL;

CREATE TABLE IF NOT EXISTS market_registry_sync_state (
    source_id         TEXT PRIMARY KEY,
    cursor            TEXT,
    run_updated_since TIMESTAMPTZ,
    run_started_at    TIMESTAMPTZ,
    watermark         TIMESTAMPTZ,
    last_attempt_at   TIMESTAMPTZ,
    last_success_at   TIMESTAMPTZ,
    backoff_until     TIMESTAMPTZ,
    failure_count     INTEGER NOT NULL DEFAULT 0,
    last_error        TEXT,
    last_stats        JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
