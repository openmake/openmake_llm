-- Migration 121 — orchestrator_jobs.session_id: job 을 만든 대화 귀속 (Codex 검토 2, 2026-09-12)
-- 같은 사용자의 다른 대화에서 만든 영상 job 이 "아까 영상" 후속 발화에 섞이지 않도록, 결정적 보정은 같은 대화의 job 만 대상으로 한다.
-- NULL(REST 등 대화 없는 호출)은 대화 없는 요청끼리만 짝을 이룬다.
ALTER TABLE orchestrator_jobs ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_orchestrator_jobs_user_session ON orchestrator_jobs (user_id, session_id, created_at DESC);
