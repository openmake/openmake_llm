-- 갤러리 호환 판정 캐시(M1, 2026-11-27) — 네임스페이스 addon:extension-marketplace:001. 멱등.
--
-- 카탈로그 항목(원본·플러그인)마다 마지막 판정 1행. 판정은 등록된 스냅샷과 설치본 근거만으로 계산한다(LLM·네트워크 없음).
-- 판정 규칙이 바뀌면(verdict_version) 또는 카탈로그가 다시 동기화되면(catalog_synced_at) 다시 계산한다.
-- 사용자 id·토큰·env 는 저장하지 않는다 — 판정·사유 코드·공개 출처(게시자·커밋·라이선스)만.
-- 카탈로그 원본이 지워지면 함께 지워진다.
CREATE TABLE IF NOT EXISTS market_verdicts (
    catalog_id        TEXT NOT NULL REFERENCES extension_catalog_sources(id) ON DELETE CASCADE,
    plugin_name       TEXT NOT NULL,
    source_url        TEXT NOT NULL,
    commit_sha        TEXT,
    verdict           TEXT NOT NULL CHECK (verdict IN ('supported', 'partial', 'unsupported')),
    reasons           JSONB NOT NULL DEFAULT '[]'::jsonb,
    provenance        JSONB NOT NULL DEFAULT '{}'::jsonb,
    evaluated         TEXT NOT NULL,
    verdict_version   INTEGER NOT NULL,
    catalog_synced_at TIMESTAMPTZ,
    computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at        TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (catalog_id, plugin_name)
);
