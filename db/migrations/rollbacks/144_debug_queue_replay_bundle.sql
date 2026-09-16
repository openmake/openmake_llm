-- 144 롤백 — REPLAY_CAPTURE_ENABLED=false 배포 후 실행(2단계)
DROP INDEX IF EXISTS idx_debug_queue_request_id;
ALTER TABLE conversation_debug_queue DROP COLUMN IF EXISTS replay_truncated;
ALTER TABLE conversation_debug_queue DROP COLUMN IF EXISTS request_id;
ALTER TABLE conversation_debug_queue DROP COLUMN IF EXISTS replay_bundle;
