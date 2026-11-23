-- 204 되돌리기 — 완료 검증 종합 컬럼을 지운다. 코드 참조(agent-task-repository verificationStatus)를 먼저 걷어낸 뒤 실행한다.
ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_verification_status_check;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS verification_status;
