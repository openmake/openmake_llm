-- Migration 105 — 내부 마켓플레이스 번들 (2026-08-25)
--
-- "마켓플레이스에 게시"를 GitHub PR 이 아니라 **이 배포 안에서** 끝낸다(사용자 결정: openmake_llm 에만
-- 설치). 사용자가 만든 스킬·Custom Agent·MCP 설정을 플러그인 규격 파일 묶음으로 변환해 여기 저장하고,
-- 소유자의 user_extensions 행(source_url = internal://bundle/<id>, visibility=shared)이 갤러리에 노출된다.
-- 다른 사용자의 설치는 기존 확장 ingest 가 InternalBundleFetcher 로 이 테이블을 읽어 수행한다
-- (draft → 승인 라이프사이클 동일). 외부로는 아무것도 나가지 않는다.
--
-- files: [{ path, encoding: 'utf8'|'base64', content }] — 원본 바이트 보존(base64). 상한은 서비스가 강제.
-- 멱등.

CREATE TABLE IF NOT EXISTS marketplace_bundles (
    id           TEXT PRIMARY KEY,
    owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    version      TEXT NOT NULL DEFAULT '1.0.0',
    description  TEXT,
    category     TEXT,
    sha          TEXT NOT NULL,
    files        JSONB NOT NULL,
    total_bytes  INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, name)
);
CREATE INDEX IF NOT EXISTS idx_marketplace_bundles_owner ON marketplace_bundles (owner_id);
