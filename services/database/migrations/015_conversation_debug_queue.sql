-- ============================================================
-- 015_conversation_debug_queue.sql
-- ============================================================
-- 디버깅·재현용 임시 메시지 큐. saveHistory=false 환경에서
-- 본문이 저장되지 않아도 에러 발생/사용자 신고 시점에는 본문을 임시 보존하여
-- 운영자가 재현할 수 있도록 한다.
--
-- 보존 정책:
--   - reason='auto-error': 에러 발생 시 자동 저장 (TTL 24시간)
--   - reason='user-report': 사용자가 🚩 버튼으로 신고 (TTL 7일)
-- expires_at 도달 시 cleanup cron 이 자동 삭제
--
-- @see services/database/migrations/014_conversation_audit_log.sql (메타 감사 로그)
-- @see scheduler 의 debug-queue-cleanup task (TTL 만료 정리)
-- ============================================================

-- ── 운영 DB 권한 정합 (014 와 동일 graceful 패턴) ──
DO $$
BEGIN
    EXECUTE format('ALTER TABLE IF EXISTS conversation_debug_queue OWNER TO %I', current_user);
    RAISE NOTICE '015: ownership normalized to %', current_user;
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE '015: ALTER OWNER skipped (current_user lacks superuser/owner privilege)';
    WHEN OTHERS THEN
        RAISE NOTICE '015: ALTER OWNER skipped (%)', SQLERRM;
END $$;

CREATE TABLE IF NOT EXISTS conversation_debug_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('auto-error', 'user-report')),
    user_message TEXT NOT NULL,
    assistant_message TEXT NOT NULL DEFAULT '',  -- 부분 응답일 수 있음, 빈 문자열 가능
    error_code TEXT,                              -- reason='auto-error' 시만 채워짐
    routing_metadata JSONB                         -- model, agent, queryType 등 운영 메타
);

-- ── 인덱스 (graceful — owner 부재 시 skip) ──
DO $$
BEGIN
    -- TTL 만료 빠른 정리용 — cleanup cron 이 매시간 expires_at < now() 조건으로 DELETE
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_debug_queue_expires ON conversation_debug_queue (expires_at)';
    -- 사용자별 신고 이력 조회용
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_debug_queue_user ON conversation_debug_queue (user_id, captured_at DESC)';
    -- 세션별 디버그 추적용
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_debug_queue_session ON conversation_debug_queue (session_id, captured_at DESC)';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE '015: CREATE INDEX skipped (table owner mismatch)';
END $$;

-- ── COMMENT (graceful) ──
DO $$
BEGIN
    EXECUTE 'COMMENT ON TABLE conversation_debug_queue IS ''에러 자동 저장 + 사용자 신고 본문 임시 보존 — TTL 후 자동 삭제''';
    EXECUTE 'COMMENT ON COLUMN conversation_debug_queue.reason IS ''auto-error (24h TTL) | user-report (7d TTL)''';
    EXECUTE 'COMMENT ON COLUMN conversation_debug_queue.assistant_message IS ''부분 응답 가능 — 첫 토큰 전 에러면 빈 문자열''';
EXCEPTION
    WHEN insufficient_privilege THEN
        RAISE NOTICE '015: COMMENT skipped (table owner mismatch)';
END $$;
