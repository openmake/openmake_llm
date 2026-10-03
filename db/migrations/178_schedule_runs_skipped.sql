-- 178: 예약 발화 이력에 'skipped' 결과 추가.
-- 이전 실행이 아직 돌고 있어 이번 발화를 건너뛴 경우를 기록한다(같은 리포트의 중복 생성·게시 파일 덮어쓰기 방지).
-- 멱등: 제약을 지우고 다시 만든다.
ALTER TABLE agent_task_schedule_runs DROP CONSTRAINT IF EXISTS agent_task_schedule_runs_outcome_check;
ALTER TABLE agent_task_schedule_runs
    ADD CONSTRAINT agent_task_schedule_runs_outcome_check CHECK (outcome IN ('fired', 'error', 'skipped'));
