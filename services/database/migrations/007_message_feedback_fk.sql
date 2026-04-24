-- ============================================================
-- Migration 007: message_feedback FK 및 인덱스 추가
-- ============================================================
--
-- 목적: message_feedback 테이블에 FK 제약과 user_id 인덱스를 추가합니다.
--       - session_id → conversation_sessions(id) ON DELETE CASCADE
--       - user_id → users(id) ON DELETE SET NULL
--       - idx_feedback_user 인덱스 (getFeedbackStats 쿼리 성능)
--
-- 실행 방법:
--   psql -d openmake_llm -f services/database/migrations/007_message_feedback_fk.sql
--
-- 롤백:
--   ALTER TABLE message_feedback DROP CONSTRAINT IF EXISTS fk_feedback_session_id;
--   ALTER TABLE message_feedback DROP CONSTRAINT IF EXISTS fk_feedback_user_id;
--   DROP INDEX IF EXISTS idx_feedback_user;
--   DELETE FROM migration_versions WHERE version = '007';
--
-- ============================================================

-- 마이그레이션 버전 기록
INSERT INTO migration_versions (version, filename)
VALUES ('007', '007_message_feedback_fk.sql')
ON CONFLICT (version) DO NOTHING;

-- 사전 정리: orphan FK 후보 데이터 정리 (FK 추가 시 위반 방지)
-- session: ON DELETE CASCADE 정책상 orphan 세션 참조는 어차피 삭제 대상 → 사전 삭제
DELETE FROM message_feedback
 WHERE session_id IS NOT NULL
   AND session_id NOT IN (SELECT id FROM conversation_sessions);
-- user_id: ON DELETE SET NULL 정책 → orphan은 NULL로 변경 (감사성 데이터 보존)
UPDATE message_feedback
   SET user_id = NULL
 WHERE user_id IS NOT NULL
   AND user_id NOT IN (SELECT id FROM users);

-- message_feedback.session_id → conversation_sessions(id) FK 추가 (ON DELETE CASCADE)
-- 세션 삭제 시 관련 피드백도 함께 삭제
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_feedback_session_id'
          AND table_name = 'message_feedback'
    ) THEN
        ALTER TABLE message_feedback ADD CONSTRAINT fk_feedback_session_id
            FOREIGN KEY (session_id) REFERENCES conversation_sessions(id) ON DELETE CASCADE;
    END IF;
END $$;

-- message_feedback.user_id → users(id) FK 추가 (ON DELETE SET NULL)
-- 사용자 삭제 시 피드백은 보존되고 user_id만 NULL로 설정
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_feedback_user_id'
          AND table_name = 'message_feedback'
    ) THEN
        ALTER TABLE message_feedback ADD CONSTRAINT fk_feedback_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- user_id 인덱스 추가 (getFeedbackStats 쿼리 성능 향상)
CREATE INDEX IF NOT EXISTS idx_feedback_user ON message_feedback(user_id);

-- ============================================================
-- 검증 쿼리 (수동 실행)
-- ============================================================
-- SELECT constraint_name, constraint_type
-- FROM information_schema.table_constraints
-- WHERE table_name = 'message_feedback' AND constraint_type = 'FOREIGN KEY';
--
-- SELECT indexname FROM pg_indexes WHERE tablename = 'message_feedback';
