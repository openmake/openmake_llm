-- 188: 에이전트 작업 장기 실행·후속 작업 체인 (2026-10-14 설계).
--
-- 한 작업이 턴·토큰·컨텍스트 상한에 닿으면 끝내는 대신 후속 작업으로 잇는다. 체인은 루트 id 로 묶고,
-- 앞뒤 연결은 continued_from/continued_by 로 둔다. long_running 은 루트에만(체인 예산·취소 표식),
-- continuation 은 후속 작업에만(인계 요약·세그먼트 번호·누적 사용량) 들어간다.
-- 타입은 141 의 forked_from_task_id 와 같은 TEXT. 멱등(IF NOT EXISTS). 되돌리기: rollbacks/188_agent_task_chain_rollback.sql
-- continued_by_task_id 에는 외래 키를 걸지 않는다 — 이어가기는 후속 행을 INSERT 하기 **전에** 이 열을 조건부 UPDATE 로
-- 선점한다(경합 방지). 즉시 검사 FK 면 선점이 23503 으로 실패한다. 가리키는 행이 없으면 "후속 없음"으로 읽는다.

ALTER TABLE agent_tasks
    ADD COLUMN IF NOT EXISTS chain_root_task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS continued_from_task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS continued_by_task_id TEXT,
    ADD COLUMN IF NOT EXISTS long_running JSONB,
    ADD COLUMN IF NOT EXISTS continuation JSONB;

CREATE INDEX IF NOT EXISTS idx_agent_tasks_chain_root ON agent_tasks (chain_root_task_id) WHERE chain_root_task_id IS NOT NULL;

COMMENT ON COLUMN agent_tasks.chain_root_task_id IS '체인 루트 작업 id — 루트 자신도 자기 id 를 가진다. 체인이 아니면 NULL';
COMMENT ON COLUMN agent_tasks.continued_from_task_id IS '이 작업이 이어받은 직전 세그먼트';
COMMENT ON COLUMN agent_tasks.continued_by_task_id IS '이 작업을 이어받은 다음 세그먼트 — 조건부 UPDATE 로 한 번만 채워진다(멱등 선점)';
COMMENT ON COLUMN agent_tasks.long_running IS '루트 전용 {maxDurationMs, maxTotalTokens, maxSegments, startedAt, cancelled?}';
COMMENT ON COLUMN agent_tasks.continuation IS '후속 전용 {fromTaskId, segmentIndex, reason, summary, chainUsedMs, chainUsedTokens}';
