-- 144: 디버그 큐 재현 번들 (2026-09-17, F24.7)
-- 오류·신고 시점의 마지막 LLM 요청 본문(모델·messages·tools·thinking, 인증 헤더 없음·자격증명 마스킹·이미지 생략)을 함께 보관한다.
-- request_id 는 chat_requests(142) 와 연결 — 어떤 프롬프트·도구 지문으로 난 오류인지 바로 따라간다. TTL 은 행의 expires_at 을 따른다.
ALTER TABLE conversation_debug_queue ADD COLUMN IF NOT EXISTS replay_bundle JSONB;
ALTER TABLE conversation_debug_queue ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE conversation_debug_queue ADD COLUMN IF NOT EXISTS replay_truncated BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_debug_queue_request_id ON conversation_debug_queue (request_id);
