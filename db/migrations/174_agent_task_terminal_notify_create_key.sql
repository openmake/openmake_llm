-- 174: 종료 알림 표식 + 작업 생성 멱등 키 (2026-10-02)
--
-- terminal_notify_pending — 작업이 종료 상태(completed·failed·cancelled)로 바뀔 때 "알림을 보내야 함"을 같은 쓰기로 남기고,
--   화면 이벤트·푸시를 보낸 뒤 지운다. 결과는 저장됐는데 알림 전에 프로세스가 죽으면 표식이 남고, 주기 점검이 다시 보낸다.
-- create_idempotency_key — 클라이언트가 보낸 Idempotency-Key. (user_id, key) 유니크라 서버를 재시작하거나 여러 대로 늘려도
--   같은 키의 재요청이 작업을 두 번 만들지 못한다(종전엔 프로세스 메모리에만 기억했다). 키가 없는 생성은 NULL — 제약 밖.
-- 멱등.
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS terminal_notify_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS create_idempotency_key TEXT;
COMMENT ON COLUMN agent_tasks.terminal_notify_pending IS '종료 알림을 아직 보내지 못함 — 주기 점검이 다시 보낸다 (174)';
COMMENT ON COLUMN agent_tasks.create_idempotency_key IS '생성 요청의 Idempotency-Key — (user_id, key) 유니크 (174)';
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_user_create_key
    ON agent_tasks (user_id, create_idempotency_key) WHERE create_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tasks_terminal_notify_pending
    ON agent_tasks (updated_at) WHERE terminal_notify_pending;
