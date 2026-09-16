-- 141: 턴 체크포인트 이력 + 체크포인트 분기 (F08 PR-7, 2026-09-17)
-- agent_tasks.checkpoint 는 여전히 최신 1개(124). 이력은 작업당 최근 N개(AGENT_TASK_LIMITS.CHECKPOINT_KEEP)만 유지하고
-- 완료 후에도 남겨 fork 의 원천이 된다. fork 는 새 pending 작업(checkpoint=선택 턴)이며 기존 /resume 로 시작한다(전이표 변경 없음). 멱등.
CREATE TABLE IF NOT EXISTS agent_task_checkpoints (
    id           BIGSERIAL PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    turn         INTEGER NOT NULL,
    conversation JSONB NOT NULL,
    plan         JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, turn)
);
ALTER TABLE agent_tasks
    ADD COLUMN IF NOT EXISTS forked_from_task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS forked_from_turn    INTEGER;
COMMENT ON TABLE agent_task_checkpoints IS '턴 단위 체크포인트 이력(최근 N개) — 체크포인트 분기(fork)의 원천 (141)';
