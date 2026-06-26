-- 048: Agent Task 영속 샌드박스 추적 컬럼 (Manus화 Phase 1 / C1)
--
-- 자율 에이전트 task 가 사용하는 영속 Docker 컨테이너(services/task-sandbox)와
-- 호스트 workspace 디렉토리를 추적한다. 비정상 종료 시 정리·복구(orphan reaping)에 사용.
-- 멱등 작성 — 재실행 안전. (수동 적용: cli.ts migrate)

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS sandbox_container_id TEXT;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS workspace_path TEXT;

COMMENT ON COLUMN agent_tasks.sandbox_container_id IS 'task 영속 샌드박스 컨테이너 이름/ID (omk-task-*). 정리·복구용.';
COMMENT ON COLUMN agent_tasks.workspace_path IS 'task 호스트 workspace 디렉토리 경로. 산출물 회수·정리용.';
