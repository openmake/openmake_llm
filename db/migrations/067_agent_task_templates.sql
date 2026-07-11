-- 067: Agent Task 템플릿 (Phase 6-1)
--
-- 반복 사용하는 작업 goal 을 파라미터({{name}})와 함께 템플릿으로 저장하고,
-- instantiate 로 파라미터를 치환해 task 를 생성한다. 스케줄과 별개(스케줄은 확정 goal 보관).
-- 멱등(IF NOT EXISTS). 수동 적용(cli.ts migrate).

CREATE TABLE IF NOT EXISTS agent_task_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- goal 본문. {{param}} 자리는 instantiate 시 치환.
    goal_template TEXT NOT NULL,
    -- 파라미터 정의 [{name, description?, default?}] — UI 폼 렌더·기본값 채움용.
    params JSONB,
    max_turns INTEGER DEFAULT 10,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_task_templates_user ON agent_task_templates(user_id);

COMMENT ON TABLE agent_task_templates IS 'Agent Task goal 템플릿({{param}} 치환) — instantiate 로 task 생성.';
