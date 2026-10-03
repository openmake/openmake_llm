-- 181 되돌리기: 실행 결과 반영 칸 제거.
ALTER TABLE agent_task_schedules DROP COLUMN IF EXISTS last_failure_signature;
ALTER TABLE agent_task_schedules DROP COLUMN IF EXISTS disabled_reason;
