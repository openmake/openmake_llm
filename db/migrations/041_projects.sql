-- Migration 041 — projects 테이블
--
-- 사용자별 프로젝트 (관련 대화를 묶어 컨텍스트를 공유하는 단위).
-- user_agents (033) 도메인을 1:1 미러링한 단순 CRUD 도메인.
--
-- 도입 배경: 프로젝트 도메인 풀스택 신설. 본인 전용 영구 보관.

CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,                       -- uuid
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_user_active
    ON projects(user_id, is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_projects_user_updated
    ON projects(user_id, updated_at DESC);

COMMENT ON TABLE projects IS
    '사용자별 프로젝트. 관련 대화를 묶어 컨텍스트를 공유하는 단위. 본인 전용 영구 보관.';
