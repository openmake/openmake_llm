-- 157 롤백 — 2단계 원칙: 코드 참조 제거 배포 후 실행
DROP INDEX IF EXISTS idx_sessions_tags;
DROP INDEX IF EXISTS idx_sessions_folder;
ALTER TABLE conversation_sessions DROP COLUMN IF EXISTS tags;
ALTER TABLE conversation_sessions DROP COLUMN IF EXISTS folder_id;
DROP TABLE IF EXISTS conversation_folders;
