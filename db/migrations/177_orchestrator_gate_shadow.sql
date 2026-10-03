-- Migration 177 — 미디어 게이트 셰도우 판정 컬럼 (orchestrator_runs)
--
-- 의사결정 어댑터(jev-decision)에 "이번 턴에 이미지·음악·영상 작업이 필요한가"를 물은 결과를 Planner 결과와 나란히 적재한다.
-- 기록 전용이다 — Planner 를 단순 턴에서 생략하는 데 쓸 수 있는지(일치율, 놓친 미디어 요청 수)를 실측하는 근거.
-- 판정하지 않은 턴(결정 모델 없음·셰도우 꺼짐)은 전부 NULL.

ALTER TABLE orchestrator_runs ADD COLUMN IF NOT EXISTS gate_model  TEXT;
ALTER TABLE orchestrator_runs ADD COLUMN IF NOT EXISTS gate_p_true REAL;     -- 미디어 작업이 필요하다고 본 확률(0~1). 판정 실패면 NULL
ALTER TABLE orchestrator_runs ADD COLUMN IF NOT EXISTS gate_ms     INTEGER;
ALTER TABLE orchestrator_runs ADD COLUMN IF NOT EXISTS gate_error  TEXT;
