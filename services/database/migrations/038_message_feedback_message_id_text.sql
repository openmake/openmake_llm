-- ============================================================
-- 038_message_feedback_message_id_text.sql — message_id 타입 드리프트 교정
-- ============================================================
-- 문제: init/002-schema.sql 은 message_feedback.message_id 를 TEXT 로 정의하지만,
--       구버전 스키마로 생성된 라이브 테이블은 INTEGER 로 남아 있음
--       (CREATE TABLE IF NOT EXISTS 는 기존 테이블을 갱신하지 않음).
--       메시지 ID 는 UUID(TEXT)라 피드백 저장(POST /api/chat/feedback)이
--       "invalid input syntax for type integer" 500 으로 실패했다.
--
-- 멱등: INTEGER 일 때만 ALTER. 권한 문제는 graceful 하게 경고만 남긴다.
-- ============================================================

-- 010 시절 FK(fk_feedback_message_id → conversation_messages.id INTEGER)도 함께 제거 —
-- 현행 canonical 스키마(init/002)는 message_id TEXT, FK 없음. 스트리밍 messageId(UUID)는
-- conversation_messages.id(serial)와 다른 식별자라 FK 자체가 성립하지 않는다.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'message_feedback'
          AND column_name = 'message_id'
          AND data_type = 'integer'
    ) THEN
        ALTER TABLE message_feedback DROP CONSTRAINT IF EXISTS fk_feedback_message_id;
        ALTER TABLE message_feedback
            ALTER COLUMN message_id TYPE TEXT USING message_id::text;
    END IF;
EXCEPTION WHEN insufficient_privilege THEN
    RAISE WARNING 'message_feedback.message_id 타입 변경 권한 없음 — 수동 조치 필요';
END $$;
