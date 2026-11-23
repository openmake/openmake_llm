-- 203: 스킬 수정 이력 — 이전 버전 복원용
--
-- 화면·API 의 스킬 수정(PUT /api/agents/skills/:id)은 agent_skills 행과 최신 skill_manifests 를
-- 제자리에서 덮어써서 이전 내용이 남지 않았다(새 버전 행은 매니페스트 업로드 때만 생긴다).
-- 수정 직전 내용을 여기 남기고, 복원은 그 내용으로 다시 수정한다(복원 직전 내용도 한 줄 남는다).
-- 스킬당 최근 SKILL_REVISION_KEEP(기본 30)개만 둔다. 스킬을 지우면 이력도 지운다. 멱등.

CREATE TABLE IF NOT EXISTS skill_revisions (
    id           BIGSERIAL PRIMARY KEY,
    skill_id     TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    content      TEXT NOT NULL,
    category     TEXT,
    -- 이 내용을 밀어낸 수정을 한 사람(누가 바꿨는가). 시스템 경로면 NULL
    replaced_by  TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_skill_revisions_skill ON skill_revisions (skill_id, id DESC);

COMMENT ON TABLE skill_revisions IS
    'Previous contents of a skill, saved just before each edit. Restore = edit back to a revision. See addons/skill-runtime/data/skill-revision-repository.ts.';
