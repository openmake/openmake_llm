-- ============================================================
-- 014_conversation_audit_log.sql
-- ============================================================
-- 사용자 saveHistory 토글과 무관하게 항상 기록되는 메타데이터 감사 로그.
--
-- 배경: settings.html의 "대화 기록 저장" 토글이 false일 때 conversation_messages
--       INSERT 가 스킵되면서 운영자가 사용자 활동을 추적할 수 없는 갭 발생.
--       메시지 본문(privacy)과 운영 메타(operational)를 분리하여:
--         - 본문은 사용자 통제
--         - 사용량·에러·모델 메타는 항상 기록 (GDPR purpose limitation 준수)
--
-- @see request-handler.ts saveUserMessage / saveAssistantMessage
-- @see services/ChatService.ts (audit 호출 진입점)
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_audit_log (
    id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    message_role TEXT NOT NULL,                    -- 'user' | 'assistant'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    model TEXT,
    agent_id TEXT,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    response_time_ms INTEGER,
    error_code TEXT,                                -- 정상 응답이면 NULL
    content_skipped BOOLEAN NOT NULL DEFAULT FALSE, -- saveHistory=false 면 TRUE
    content_length INTEGER NOT NULL DEFAULT 0      -- 본문 길이 (보안 모니터링)
);

-- 사용자별 시간순 조회 — Admin 대시보드 / 사용량 분석
CREATE INDEX IF NOT EXISTS idx_audit_user_time
    ON conversation_audit_log (user_id, created_at DESC);

-- 에러 로그 빠른 필터 — 에러 발생 메시지만 조회
CREATE INDEX IF NOT EXISTS idx_audit_error
    ON conversation_audit_log (error_code)
    WHERE error_code IS NOT NULL;

-- 세션별 감사 추적 — 디버깅 시 특정 세션의 전체 흐름 조회
CREATE INDEX IF NOT EXISTS idx_audit_session_time
    ON conversation_audit_log (session_id, created_at);

COMMENT ON TABLE conversation_audit_log IS
    '메시지 본문 제외 운영 메타 — saveHistory 토글과 무관하게 항상 기록';
COMMENT ON COLUMN conversation_audit_log.content_skipped IS
    'true 이면 사용자가 saveHistory=false 로 본문 저장을 차단한 메시지';
COMMENT ON COLUMN conversation_audit_log.content_length IS
    '본문 저장 여부와 무관하게 항상 길이 기록 — 비정상 길이 감지용';
