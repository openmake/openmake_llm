-- Migration 110 — 오케스트레이션 셰도우에 병렬 위임(spawn_agents) 의도 열 추가 (2026-08-26)
--
-- 086 은 토론·작업 위임 의도만 기록해 spawn_agents 의 노출→채택률을 잴 지표가 없었다
-- (실측: 자연어 "각각 조사해서" 에 qwen 이 직접 검색을 택해도 어디에도 남지 않음).
-- 설명문·가이드 조정의 효과는 이 열로 잰다.
--
-- 멱등 (IF NOT EXISTS).

ALTER TABLE orchestration_dispatch_decisions
    ADD COLUMN IF NOT EXISTS spawn_intent BOOLEAN NOT NULL DEFAULT false;
