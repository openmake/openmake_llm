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

-- TTL 만료 빠른 정리용 — cleanup cron 이 매시간 expires_at < now() 조건으로 DELETE
CREATE INDEX IF NOT EXISTS idx_debug_queue_expires
    ON conversation_debug_queue (expires_at);

-- 사용자별 신고 이력 조회용
CREATE INDEX IF NOT EXISTS idx_debug_queue_user
    ON conversation_debug_queue (user_id, captured_at DESC);

-- 세션별 디버그 추적용 — 특정 세션에서 무엇이 잘못됐는지 한눈에 확인
CREATE INDEX IF NOT EXISTS idx_debug_queue_session
    ON conversation_debug_queue (session_id, captured_at DESC);

COMMENT ON TABLE conversation_debug_queue IS
    '에러 자동 저장 + 사용자 신고 본문 임시 보존 — TTL 후 자동 삭제';
COMMENT ON COLUMN conversation_debug_queue.reason IS
    'auto-error (24h TTL) | user-report (7d TTL)';
COMMENT ON COLUMN conversation_debug_queue.assistant_message IS
    '부분 응답 가능 — 첫 토큰 전 에러면 빈 문자열';
