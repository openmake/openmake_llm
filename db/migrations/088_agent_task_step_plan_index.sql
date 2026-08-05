-- 088: 실행 스텝 → 플랜 노드 귀속 (Execution Graph 증분 2 — 노드 실체화 계측)
--
-- plan(계획)과 steps(실행 로그)는 각각 존재하지만 연결이 없어, 노드별 비용/정합
-- 실측과 노드 속성(완료 기준·비용 한도) 부착 지점이 없었다. 스텝 기록 시점의
-- "현재 in_progress 플랜 단계 인덱스"를 결정적으로 스탬프한다 (LLM 판단 없음).
-- plan 이 없는 task / 플랜 외 구간은 NULL — 기존 행·기존 동작 무영향.
ALTER TABLE agent_task_steps ADD COLUMN IF NOT EXISTS plan_step_index INTEGER;

COMMENT ON COLUMN agent_task_steps.plan_step_index IS
    '스텝 기록 시점에 in_progress 였던 플랜 단계 인덱스(0-base). plan 부재/플랜 외 구간은 NULL. 노드별 비용·정합 집계용 (088)';
