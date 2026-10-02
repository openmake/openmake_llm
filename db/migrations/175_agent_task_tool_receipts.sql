-- 175: 외부 도구 실행 영수증 (2026-10-02)
--
-- 호스트에서 도는 외부 도구(MCP·내장 외부 API — 위험 등급 external)는 샌드박스 밖에 부작용을 남긴다(메일 발송·문서 생성 등).
-- 에이전트 작업이 그런 도구를 부를 때마다 한 행을 남긴다: 실행 직전 started, 결과를 기록한 뒤 succeeded·failed.
-- 서버가 실행 도중 죽어 결과를 모르는 호출을 재개 때 다시 실행하지 않으면 outcome_unknown 으로 닫는다.
-- idempotency_key 는 작업·호출 id 로 정해져 같은 호출을 다시 실행해도 같다 — 외부 MCP 서버에 `_meta` 로 함께 보낸다.
-- 멱등.
CREATE TABLE IF NOT EXISTS agent_task_tool_receipts (
    task_id         TEXT        NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
    tool_call_id    TEXT        NOT NULL,
    tool_name       TEXT        NOT NULL,
    args_hash       TEXT        NOT NULL,
    idempotency_key TEXT        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'started',
    attempts        INTEGER     NOT NULL DEFAULT 1,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at     TIMESTAMPTZ,
    PRIMARY KEY (task_id, tool_call_id)
);
COMMENT ON TABLE agent_task_tool_receipts IS '에이전트 작업의 외부 도구 실행 영수증 — 시작·종료·멱등 키 (175)';
COMMENT ON COLUMN agent_task_tool_receipts.status IS 'started | succeeded | failed | outcome_unknown';
