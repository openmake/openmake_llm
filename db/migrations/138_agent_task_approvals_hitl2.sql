-- 138: 승인 철회·담당자·미리보기·승인 이벤트 (F18 HITL 심화 PR-1~3, 2026-09-17)
--
-- 124 의 agent_task_approvals 에 ① revoked 상태(미소비 승인 철회) ② preview(실행 전 unified diff)
-- ③ decided_by/revoked_at ④ assignee_user_id·escalated_at·escalation_reason(이관·에스컬레이션) 을 더하고,
-- 요청·결정·철회·이관을 남기는 agent_task_approval_events 를 만든다. 멱등.

ALTER TABLE agent_task_approvals DROP CONSTRAINT IF EXISTS agent_task_approvals_status_check;
ALTER TABLE agent_task_approvals ADD CONSTRAINT agent_task_approvals_status_check
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'aborted', 'revoked'));
ALTER TABLE agent_task_approvals
    ADD COLUMN IF NOT EXISTS preview           TEXT,
    ADD COLUMN IF NOT EXISTS decided_by        TEXT,
    ADD COLUMN IF NOT EXISTS revoked_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assignee_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS escalated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_agent_task_approvals_assignee_pending
    ON agent_task_approvals (assignee_user_id) WHERE status = 'pending' AND assignee_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_task_approvals_recent
    ON agent_task_approvals (user_id, decided_at DESC) WHERE status IN ('approved', 'revoked');

CREATE TABLE IF NOT EXISTS agent_task_approval_events (
    id          BIGSERIAL PRIMARY KEY,
    approval_id TEXT NOT NULL REFERENCES agent_task_approvals(approval_id) ON DELETE CASCADE,
    actor_id    TEXT,
    kind        TEXT NOT NULL CHECK (kind IN ('requested', 'approved', 'rejected', 'answered', 'revoked', 'reassigned', 'escalated', 'expired', 'aborted')),
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_task_approval_events_approval ON agent_task_approval_events (approval_id, id);

COMMENT ON COLUMN agent_task_approvals.preview IS '승인 요청 시점 실행 전 미리보기(unified diff, 캡). 파일 도구 외 NULL (138)';
COMMENT ON COLUMN agent_task_approvals.assignee_user_id IS '현재 담당자. NULL=작업 소유자(user_id). 같은 조직 멤버·admin 만 배정 (138)';
COMMENT ON TABLE agent_task_approval_events IS '승인 수명주기 이벤트(요청·결정·철회·이관) — 감사·디버깅 (138)';
