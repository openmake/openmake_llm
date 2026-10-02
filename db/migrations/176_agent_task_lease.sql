-- 176: 에이전트 작업 실행 소유권 (2026-10-02)
--
-- 실행 중인 작업의 소유권은 종전에 프로세스 메모리뿐이었다. 서버가 죽으면 그 서버가 다시 뜰 때까지 아무도 이어받지 못했고,
-- 부팅 때의 일괄 실패 표시는 다른 서버가 실행 중인 작업까지 건드렸다(서버를 여러 대로 늘릴 수 없었다).
-- lease_owner — 지금 이 작업을 실행 중인 프로세스(`호스트명:PM2 인스턴스 번호`). 실행이 끝나면 NULL.
-- lease_until — 소유권 만료 시각. 실행 중인 프로세스가 주기적으로 연장하고, 지나면 주기 점검이 가져가 체크포인트에서 이어 실행한다.
-- 멱등.
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
COMMENT ON COLUMN agent_tasks.lease_owner IS '실행 소유권을 쥔 프로세스 — 호스트명:인스턴스 번호 (176)';
COMMENT ON COLUMN agent_tasks.lease_until IS '실행 소유권 만료 시각 — 지나면 다른 프로세스가 가져간다 (176)';
CREATE INDEX IF NOT EXISTS idx_agent_tasks_lease_until
    ON agent_tasks (lease_until) WHERE lease_until IS NOT NULL;
