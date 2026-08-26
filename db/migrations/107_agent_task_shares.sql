-- Migration 107 — 에이전트 작업 읽기 전용 공유 (2026-08-26)
--
-- 완료된 작업의 결과·진행 기록·변경분을 링크로 공유한다. plan:
-- `openmake_llm-docs/proposals/2026-08-26-agent-task-share-plan.md`
--
-- 설계상 중요한 두 가지:
--   ① `snapshot` 은 **게시 시점에 조립된 공유 문서**다(원본 조인 아님). 라이브 조인이면
--      이후 resume·재실행으로 생긴 새 민감 정보가 자동 노출된다 — 공유는 사용자가 미리보기로
--      확인한 그 내용에서 고정된다.
--   ② visibility 는 아티팩트 공유(`artifact_publications`)와 같은 3단 모델을 쓴다:
--      private(소유자만) / authenticated(로그인 사용자) / link(share_token 보유자).
--
-- 멱등 (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS agent_task_shares (
    share_id      TEXT PRIMARY KEY,
    task_id       TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visibility    TEXT NOT NULL DEFAULT 'private'
                  CHECK (visibility IN ('private', 'authenticated', 'link')),
    -- link 전용 — 추측 불가 난수. 다른 visibility 에서는 NULL.
    share_token   TEXT,
    -- 게시 시점 공유 문서(buildShareDocument 결과)
    snapshot      JSONB NOT NULL,
    include_diff  BOOLEAN NOT NULL DEFAULT TRUE,
    include_steps BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 작업당 공유는 하나 — 재게시는 갱신(upsert)이다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_shares_task ON agent_task_shares (task_id);
CREATE INDEX IF NOT EXISTS idx_task_shares_owner ON agent_task_shares (owner_user_id, created_at DESC);
