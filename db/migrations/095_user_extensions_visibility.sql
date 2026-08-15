-- Migration 095 — user_extensions.visibility (Phase 3: 워크스페이스 공유/갤러리)
--
-- 2026-08-16. user_agents.visibility(080) 관용구 동형 — 'private'(기본, 소유자 전용)
-- | 'shared'(워크스페이스 전원이 갤러리에서 조회·설치 가능).
--
-- 공유는 "소스 포인터" 공유다: 갤러리 설치는 요청자 본인 계정으로 동일 git ingest 를
-- 재실행하므로 구성요소(skill/MCP draft)는 설치자 소유로 새로 생성되고 draft→승인
-- 라이프사이클을 그대로 따른다. 소유자의 구성요소가 공유되는 것이 아님 (권한 상승 없음).
-- 편집(visibility 변경)/삭제는 소유자 한정 (구조적 보존).
--
-- 멱등 (ADD COLUMN IF NOT EXISTS + DO/EXCEPTION 제약 가드).

ALTER TABLE user_extensions ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

DO $$ BEGIN
    ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_visibility_chk
        CHECK (visibility IN ('private', 'shared'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 갤러리 목록 조회 부분 인덱스 (listShared 의 visibility='shared' AND status='active')
CREATE INDEX IF NOT EXISTS idx_user_extensions_shared
    ON user_extensions (visibility) WHERE visibility = 'shared' AND status = 'active';

COMMENT ON COLUMN user_extensions.visibility IS
    'private(기본, 소유자 전용) | shared(워크스페이스 갤러리 노출). 갤러리 설치는 설치자 본인 ingest 재실행. visibility 변경/삭제는 소유자 한정.';
