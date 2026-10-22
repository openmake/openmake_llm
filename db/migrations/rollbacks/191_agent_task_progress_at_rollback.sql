-- 191 되돌리기 — 마지막 진행 시각 열과 부분 인덱스 제거. 진행 기록만 사라진다(작업 상태·결과는 그대로).
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 읽지 않는다).
DROP INDEX IF EXISTS idx_agent_tasks_running_progress;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS last_progress_at;
