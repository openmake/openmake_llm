-- 200: 에이전트 작업의 worktree 격리 상태 — 로컬 실행에서 격리가 걸렸는지·왜 안 걸렸는지·정리 결과
--
-- 로컬 실행기(로컬 브리지)는 작업 시작 때 연결 폴더 안에 작업용 worktree 를 자동으로 만들고, 실패하면
-- 격리 없이 연결 폴더에서 직접 작업한다(fail-open). 그 결과를 서버가 정해 이 열에 남기고 화면이 그대로 그린다.
-- 값은 packages/shared-types AgentTaskIsolation:
--   {"state":"worktree","branch":"…","worktreeRel":"…","outcome":"kept"|"removed"?}
--     worktreeRel = 실행 폴더(연결 폴더 + folder_rel) 기준 상대경로
--   {"state":"direct","reason":"not_repo"|"disabled"|"unavailable"}
-- NULL = 해당 없음(샌드박스 실행, 옛 행). additive·멱등.

ALTER TABLE agent_tasks
    ADD COLUMN IF NOT EXISTS isolation JSONB;

COMMENT ON COLUMN agent_tasks.isolation IS
    '로컬 실행의 worktree 격리 상태(200) — shared-types AgentTaskIsolation. NULL 은 해당 없음(샌드박스·옛 행)';
