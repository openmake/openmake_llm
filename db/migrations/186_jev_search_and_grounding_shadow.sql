-- 186: 의사결정 어댑터의 기록 전용 판정 두 가지.
--
-- (1) 검색 게이트 — "이 요청에 웹 검색이 필요한가". 미디어 게이트(177)와 같은 행(orchestrator_runs)에 남긴다.
-- (2) 근거 게이트 — "이 답이 그 턴의 검색 출처에 근거했는가". 답을 저장한 뒤의 판정이라 별도 테이블에 남긴다.
--     답·출처 본문은 복사하지 않는다 — 검토는 message_id 로 conversation_messages(본문·sources)와 조인해서 한다
--     (FK 는 두지 않아 대화를 지워도 기록 행은 남는다).
-- 둘 다 동작을 바꾸지 않는 실측 근거다. 멱등(IF NOT EXISTS). 되돌리기: rollbacks/186_jev_search_and_grounding_shadow_rollback.sql

ALTER TABLE orchestrator_runs
    ADD COLUMN IF NOT EXISTS search_gate_p_true REAL,
    ADD COLUMN IF NOT EXISTS search_gate_ms INTEGER,
    ADD COLUMN IF NOT EXISTS search_gate_error TEXT;

COMMENT ON COLUMN orchestrator_runs.search_gate_p_true IS '검색 게이트 — 웹 검색이 필요할 확률(0~1). 판정하지 않았거나 실패면 NULL';

CREATE TABLE IF NOT EXISTS chat_grounding_gate_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    message_id INTEGER,
    p_true REAL,
    gate_error TEXT,
    gate_ms INTEGER NOT NULL,
    gate_model TEXT,
    source_count INTEGER NOT NULL,
    answer_chars INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_grounding_gate_log_created_at ON chat_grounding_gate_log (created_at);

COMMENT ON TABLE chat_grounding_gate_log IS '근거 게이트 판정 기록 — 답이 그 턴의 검색 출처에 근거했는지에 대한 의사결정 어댑터의 확률(본문 미저장)';
COMMENT ON COLUMN chat_grounding_gate_log.message_id IS '저장된 답 메시지(conversation_messages.id)';
COMMENT ON COLUMN chat_grounding_gate_log.p_true IS '답이 출처에 근거했을 확률(0~1). 판정 실패면 NULL';
COMMENT ON COLUMN chat_grounding_gate_log.source_count IS '판정에 쓴 출처 수';
