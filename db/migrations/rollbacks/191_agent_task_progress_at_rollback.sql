-- 191 되돌리기 — 마지막 진행 시각 열 제거(인덱스는 두지 않는다 — 조회는 status 인덱스로 충분, HOT 업데이트 유지). 진행 기록만 사라진다(작업 상태·결과는 그대로).
-- 코드만 이전 버전으로 되돌리는 롤백에는 이 파일이 필요 없다(이전 코드는 이 열을 읽지 않는다).
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS last_progress_at;
