-- 189: 에이전트 작업 체인 — continued_by_task_id 의 외래 키 제거 (2026-10-14 최종 검토).
--
-- 188 은 처음에 continued_by_task_id 에 FK(agent_tasks_continued_by_task_id_fkey)를 걸었다가, 이어가기 선점이
-- 후속 행 INSERT 보다 먼저 이 열을 UPDATE 하므로(즉시 검사 FK 면 23503) FK 없는 정의로 고쳤다.
-- 고치기 전 188 이 이미 적용된 DB(로컬 개발 DB 등)에는 FK 가 남아 있으므로 여기서 보정한다.
-- 새 188 로 만든 DB 에는 제약이 없어 아무 일도 하지 않는다(IF EXISTS — 멱등). 되돌리기: rollbacks/189_agent_task_chain_drop_continued_by_fk_rollback.sql

ALTER TABLE agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_continued_by_task_id_fkey;
