-- 삭제된 중복 행은 복구되지 않는다(적용 전 SELECT … INTO 로 백업할 것)
DROP INDEX IF EXISTS uniq_conv_messages_client;
DROP INDEX IF EXISTS idx_conv_sessions_parent;
ALTER TABLE conversation_sessions DROP COLUMN IF EXISTS version;
