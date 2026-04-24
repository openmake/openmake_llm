-- ============================================================
-- Migration 010: feedback 스키마 타입 통일 및 FK 추가
-- ============================================================
--
-- 목적:
--   1. message_feedback.message_id: TEXT → INTEGER 타입 통일
--      conversation_messages.id (SERIAL)와 타입 일치 + FK 참조
--   2. agent_feedback.agent_id: custom_agents(id) FK 추가
--
-- 배경:
--   - message_feedback.message_id가 TEXT이므로 JOIN 시 타입 불일치,
--     인덱스 사용 불가 (OWASP A05 / 기능 장애 위험)
--   - agent_feedback.agent_id에 FK 없어 고아 레코드 발생 가능
--
-- 롤백:
--   ALTER TABLE message_feedback ALTER COLUMN message_id TYPE TEXT USING message_id::TEXT;
--   ALTER TABLE message_feedback DROP CONSTRAINT IF EXISTS fk_feedback_message_id;
--   ALTER TABLE agent_feedback DROP CONSTRAINT IF EXISTS fk_agent_feedback_agent_id;
--   DELETE FROM migration_versions WHERE version = '010';
--
-- ============================================================

INSERT INTO migration_versions (version, filename)
VALUES ('010', '010_feedback_schema_fixes.sql')
ON CONFLICT (version) DO NOTHING;

-- ---------------------------------------------------------------
-- 1. message_feedback.message_id: TEXT → INTEGER + FK
-- ---------------------------------------------------------------
-- 사전 정리: 비숫자 message_id (UUID, msg-{ts} 등 legacy 형식)는
-- conversation_messages.id (INTEGER SERIAL)와 매핑 불가능한 orphan이므로 삭제.
-- 운영 데이터 손실 가능성 → backend/api/logs/db-backups/ 에 사전 dump 권장
-- (운영 환경에서는 openmake_llm.sh deploy가 실행 전 자동 백업)
DELETE FROM message_feedback
 WHERE message_id IS NOT NULL
   AND message_id !~ '^[0-9]+$';

DO $$
BEGIN
    -- 컬럼 타입 변경 (TEXT → INTEGER)
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'message_feedback'
          AND column_name = 'message_id'
          AND data_type = 'text'
    ) THEN
        -- 기존 인덱스 제거 후 재생성 (타입 변경 시 필요)
        DROP INDEX IF EXISTS idx_feedback_message;
        ALTER TABLE message_feedback
            ALTER COLUMN message_id TYPE INTEGER USING message_id::INTEGER;
        CREATE INDEX IF NOT EXISTS idx_feedback_message ON message_feedback(message_id);
    END IF;

    -- FK 추가 전 추가 정합성 확인: INTEGER로 바뀐 후에도 conversation_messages에 없는 ID가
    -- 있을 수 있으므로 orphan 추가 정리 (CASCADE 정책이라 어차피 삭제 대상)
    DELETE FROM message_feedback
     WHERE message_id IS NOT NULL
       AND message_id NOT IN (SELECT id FROM conversation_messages);

    -- FK 제약 추가 (conversation_messages.id ON DELETE CASCADE)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_feedback_message_id'
          AND table_name = 'message_feedback'
    ) THEN
        ALTER TABLE message_feedback
            ADD CONSTRAINT fk_feedback_message_id
            FOREIGN KEY (message_id) REFERENCES conversation_messages(id) ON DELETE CASCADE;
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 2. agent_feedback.agent_id → custom_agents(id) FK 추가
-- ---------------------------------------------------------------
-- agent_feedback 테이블이 custom_agents보다 먼저 정의되어 있으므로
-- 인라인 FK 불가 → ALTER TABLE로 추가
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_agent_feedback_agent_id'
          AND table_name = 'agent_feedback'
    ) THEN
        -- custom_agents 테이블이 존재할 때만 추가
        IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_name = 'custom_agents'
        ) THEN
            ALTER TABLE agent_feedback
                ADD CONSTRAINT fk_agent_feedback_agent_id
                FOREIGN KEY (agent_id) REFERENCES custom_agents(id) ON DELETE CASCADE;
        END IF;
    END IF;
END $$;

-- ---------------------------------------------------------------
-- 3. conversation_messages.agent_id 인덱스 추가 (P1-8 병행 처리)
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_agent ON conversation_messages(agent_id);

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'message_feedback' AND column_name = 'message_id';
--
-- SELECT constraint_name, constraint_type FROM information_schema.table_constraints
-- WHERE table_name IN ('message_feedback', 'agent_feedback') AND constraint_type = 'FOREIGN KEY';
