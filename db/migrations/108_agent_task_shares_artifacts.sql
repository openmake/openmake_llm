-- Migration 108 — 공유 범위 토글에 산출물(artifact) 추가 (2026-08-26)
--
-- 107 에는 include_diff·include_steps 만 있었다. 작업 산출물(artifact 스텝)은 공유 문서에서
-- 별도 필드로 나가므로 스텝·diff 와 같은 축의 토글이 필요하다. 기본은 포함(TRUE) —
-- 산출물이 곧 작업의 결과물이라 빼면 공유 가치가 크게 준다.
--
-- 멱등 (IF NOT EXISTS).

ALTER TABLE agent_task_shares
    ADD COLUMN IF NOT EXISTS include_artifacts BOOLEAN NOT NULL DEFAULT TRUE;
