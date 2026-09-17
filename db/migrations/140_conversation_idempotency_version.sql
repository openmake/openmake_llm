-- 140: 메시지 멱등 키·세션 낙관적 잠금 (F08 PR-5, 2026-09-17)
--
-- conversation_messages.client_message_id(099) 는 assistant 행에만 서버 발급 id 가 들어갔다. 이제 클라이언트가 발급한
-- clientRequestId 를 user 행에도 실어 재전송·더블클릭·네트워크 재시도가 같은 메시지를 두 번 저장·두 번 생성하지 않게
-- (session_id, client_message_id, role) 부분 유니크로 막는다. 사전 정리: 같은 키 중복은 낮은 id 만 남긴다(실측 0건 예상 — 서버 발급 UUID).
-- conversation_sessions.version 은 제목 등 쓰기의 낙관적 잠금(PATCH expectedVersion → 409). 멱등.

DELETE FROM conversation_messages m USING conversation_messages d
 WHERE m.client_message_id IS NOT NULL AND m.session_id = d.session_id AND m.role = d.role
   AND m.client_message_id = d.client_message_id AND m.id > d.id;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_conv_messages_client
    ON conversation_messages (session_id, client_message_id, role) WHERE client_message_id IS NOT NULL;

ALTER TABLE conversation_sessions ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_conv_sessions_parent
    ON conversation_sessions ((metadata->>'parentSessionId')) WHERE metadata ? 'parentSessionId';
COMMENT ON COLUMN conversation_sessions.version IS '낙관적 잠금 버전 — 제목 등 쓰기마다 +1, PATCH expectedVersion 불일치 시 409 (140)';
