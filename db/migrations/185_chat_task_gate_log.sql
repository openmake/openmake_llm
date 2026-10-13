-- 185: 작업 게이트 기록 — 채팅 요청이 여러 단계의 작업(agent-task)에 맞는지에 대한 의사결정 어댑터 판정을 남긴다.
--
-- 기록 전용(셰도우)으로 시작하는 판정의 실측 근거다. 요청 본문은 복사하지 않는다 — 검토는 message_id 로
-- conversation_messages 와 조인해서 하고, 대화를 지우면 검토용 본문도 함께 사라진다(FK 는 두지 않아 기록 행은 남는다).
-- 멱등(IF NOT EXISTS). 되돌리기: rollbacks/185_chat_task_gate_log_rollback.sql

CREATE TABLE IF NOT EXISTS chat_task_gate_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id INTEGER,
    channel TEXT NOT NULL,
    mode TEXT NOT NULL,
    source TEXT NOT NULL,
    p_true REAL,
    gate_error TEXT,
    gate_ms INTEGER NOT NULL,
    gate_model TEXT,
    suggested BOOLEAN NOT NULL DEFAULT FALSE,
    query_chars INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_task_gate_log_created_at ON chat_task_gate_log (created_at);

COMMENT ON TABLE chat_task_gate_log IS '작업 게이트 판정 기록 — 채팅 요청이 agent-task 에 맞는지에 대한 의사결정 어댑터의 확률(본문 미저장)';
COMMENT ON COLUMN chat_task_gate_log.message_id IS '저장된 답 메시지(conversation_messages.id). 답을 저장하지 않은 턴은 NULL';
COMMENT ON COLUMN chat_task_gate_log.channel IS 'web | api(API 키 요청)';
COMMENT ON COLUMN chat_task_gate_log.mode IS '판정 당시 CHAT_TASK_GATE_MODE (shadow | on)';
COMMENT ON COLUMN chat_task_gate_log.source IS 'rule(명백한 단답 — 어댑터 호출 없음) | jev(어댑터 판정)';
COMMENT ON COLUMN chat_task_gate_log.p_true IS '작업이 필요할 확률(0~1). 판정 실패면 NULL';
COMMENT ON COLUMN chat_task_gate_log.suggested IS '이 판정이 응답에 제안으로 실렸는가';
