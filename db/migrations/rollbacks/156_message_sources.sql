-- 156 롤백 — 코드 참조 제거 배포 후 실행(2단계)
ALTER TABLE conversation_messages DROP COLUMN IF EXISTS sources;
