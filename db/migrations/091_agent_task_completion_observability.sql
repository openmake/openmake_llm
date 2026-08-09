-- 091: 완료 판정 관측 (Execution Graph — 완성 판별 ①③)
--
-- 배경(2026-08-09 후향 실측, completed 155건): completed 로 나가는 출구가 3개인데
-- terminate 경로(22건·14.2%)는 goal judge·deliverable verify 를 통째로 우회했고,
-- 아티팩트가 있으면 judge 를 생략하는 규칙까지 겹쳐 **completed 의 58.7% 가 무판정**이었다.
-- 관문을 하나로 모으는 것(①)과 별개로, 그 효과를 사후 측정할 근거가 DB 에 전혀 없었다
-- (judge 판정은 로그로만 흘렀고, 완료 경로는 스텝 tool_name 역추적으로만 구분 가능).
--
--  * completion_path : 어느 출구로 완료됐는지 (final_answer | terminate). 기존 행은 NULL.
--  * judge_verdict   : goal judge 결과 (achieved | not_achieved | unknown | skipped).
--                      unknown = 호출/파싱 실패로 fail-open 통과, skipped = 발동 조건 밖.
--  * tool_args       : 도구 호출 인자(민감값 마스킹·크기 캡) — 사후 원인 분석의 관측 갭.
--
-- 기존 행·기존 동작 무영향(전부 NULL 허용).
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS completion_path TEXT;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS judge_verdict TEXT;
ALTER TABLE agent_task_steps ADD COLUMN IF NOT EXISTS tool_args JSONB;

COMMENT ON COLUMN agent_tasks.completion_path IS
    '완료 출구 구분: final_answer(도구 없는 최종 답변) | terminate(종료 도구). 미완료/기존 행은 NULL (091)';
COMMENT ON COLUMN agent_tasks.judge_verdict IS
    'goal judge 결과: achieved | not_achieved | unknown(호출·파싱 실패 fail-open) | skipped(발동 조건 밖). 기존 행은 NULL (091)';
COMMENT ON COLUMN agent_task_steps.tool_args IS
    '도구 호출 인자 — 민감 키 [REDACTED] 마스킹 + 크기 캡 적용. 사후 원인 분석용 (091)';
