-- 139: 계획 낙관적 잠금 (F18 PR-4, 2026-09-17)
-- 모든 plan 갱신(런타임 스냅샷·사용자 편집)에서 +1. PUT /api/agent-tasks/:id/plan 은 expectedVersion 불일치 시 409. 멱등.
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 1;
COMMENT ON COLUMN agent_tasks.plan_version IS 'plan 낙관적 잠금 버전 — 갱신마다 +1, 편집 API 는 expectedVersion 대조 (139)';
