-- 184 되돌리기: 추론 수준 칸 제거.
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS thinking_level;
