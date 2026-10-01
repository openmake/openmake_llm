-- 172: 실행 중 도구 호출 표식 (2026-10-01)
-- 부작용 도구(bash·파일 쓰기·외부 호출)는 실행 직전에 이 컬럼에 tool_call id 를 남기고 결과 스텝을 쓴 뒤 지운다.
-- 재시작 뒤 턴 중간 재개 때 표식이 가리키는 호출이 저널(agent_task_steps.tool_call_id, 124)에 없으면
-- "실행 도중 끊김 — 결과 불명"으로 보고 다시 실행하지 않는다(종전엔 최소 1회 재실행). 도구는 한 턴에서 순차 실행이라 작업당 하나면 된다. 멱등.
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS in_flight_tool_call_id TEXT;
COMMENT ON COLUMN agent_tasks.in_flight_tool_call_id IS '지금 실행 중인 부작용 도구 호출의 tool_call id — 재개 때 결과 불명 판정 근거 (172)';
