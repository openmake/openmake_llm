-- 091 롤백: 완료 판정 관측 컬럼 제거.
-- 관측 전용 컬럼이라 제거해도 실행 동작에는 영향이 없다(코드 참조 제거 후 적용할 것).
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS completion_path;
ALTER TABLE agent_tasks DROP COLUMN IF EXISTS judge_verdict;
ALTER TABLE agent_task_steps DROP COLUMN IF EXISTS tool_args;
