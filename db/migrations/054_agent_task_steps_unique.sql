-- 054: agent_task_steps (task_id, step_number) 유니크 보장
--
-- 실패/취소 작업을 /execute 로 처음부터 재실행하면 stepNumber 가 0 부터 다시 시작해
-- 이전 시도의 스텝과 (task_id, step_number) 가 중복됐다 (조회 ORDER BY step_number 혼선).
-- 앱은 fresh 재실행 시 이전 스텝을 삭제하도록 수정됐고(AgentTaskService), 본 마이그레이션은
-- ① 기존 중복 행 정리(같은 번호 중 최신 id 만 유지 — fresh 재실행이 이전 시도를 대체하는 의미)
-- ② 유니크 인덱스로 재발 방지(동일 task 동시 이중 실행의 스텝 교차 기록도 차단).
-- 멱등(IF NOT EXISTS + 중복 없으면 DELETE no-op). 수동 적용(cli.ts migrate).

DELETE FROM agent_task_steps a
USING agent_task_steps b
WHERE a.task_id = b.task_id
  AND a.step_number = b.step_number
  AND a.id < b.id;

-- 운영 DB owner mismatch 대비 graceful 패턴 (권한 부족 시 skip — 앱 레벨 정리가 1차 방어)
DO $$
BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_task_steps_task_step
        ON agent_task_steps(task_id, step_number);
EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'uq_agent_task_steps_task_step 생성 권한 없음 — skip';
END $$;
