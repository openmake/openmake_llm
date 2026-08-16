-- Migration 096 — extension_catalog_sources (admin 큐레이션 갤러리)
--
-- 2026-08-16. 관리자가 마켓플레이스/확장 저장소 URL 을 등록하면 플러그인 목록을
-- 스냅샷(plugins JSONB)으로 저장하고, Settings 확장 갤러리에 큐레이션 카탈로그로
-- 노출한다. 설치는 사용자가 본인 계정으로 기존 ingest 를 재실행 (권한 상승 없음).
--
-- 스냅샷은 등록 시 + 관리자 수동 동기화로 갱신 (주기 스케줄러는 실수요 게이트).
-- 소스가 marketplace.json 없이 단일 plugin.json 이면 1개짜리 카탈로그로 취급.
--
-- 멱등 (CREATE TABLE IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS extension_catalog_sources (
    id             TEXT PRIMARY KEY,                 -- 'ext-cat-<uuid>'
    url            TEXT NOT NULL UNIQUE,             -- git 저장소/마켓플레이스/.zip URL
    name           TEXT NOT NULL,                    -- 마켓플레이스 이름 (또는 plugin name)
    description    TEXT,
    plugins        JSONB NOT NULL,                   -- [{name, description, version?}] 스냅샷
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,    -- false = 갤러리 미노출 (soft off)
    added_by       TEXT REFERENCES users(id) ON DELETE SET NULL,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_extension_catalog_enabled
    ON extension_catalog_sources (enabled) WHERE enabled = TRUE;

COMMENT ON TABLE extension_catalog_sources IS
    'admin 큐레이션 확장 카탈로그 — 등록된 소스의 플러그인 목록 스냅샷. 설치는 사용자 본인 ingest 재실행.';
COMMENT ON COLUMN extension_catalog_sources.plugins IS
    'fetchCatalogSnapshot 산출물: [{name, description?, version?}]. 동기화 시 전체 교체.';
