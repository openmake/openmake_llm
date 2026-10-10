-- 184: 에이전트 작업의 추론 수준 보존 — 재개·분기된 작업이 처음의 선택을 잃지 않게 한다 (Companion P5 1단계)
--
-- 추론 수준('off' | 'low' | 'medium' | 'high')은 실행 요청(/execute)에만 실려 온다. 주차·부팅 복구·분기 재개는 요청 본문
-- 없이 행만으로 실행 입력을 다시 만들므로, 행에 남기지 않으면 'off' 로 돌아간다. NULL 은 "지정 없음"(off) — 기존 행은 그대로 둔다.
-- 멱등(ADD COLUMN IF NOT EXISTS). 되돌리기: rollbacks/184_agent_task_thinking_level_rollback.sql

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS thinking_level TEXT;

COMMENT ON COLUMN agent_tasks.thinking_level IS '실행 요청의 추론 수준(off|low|medium|high) — 재개·분기 때 복원. NULL 은 지정 없음(off).';
