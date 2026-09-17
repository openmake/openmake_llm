-- 133 롤백 — 코드 참조 제거 배포 후 실행(2단계)
ALTER TABLE mcp_server_instances DROP COLUMN IF EXISTS tools_count;
ALTER TABLE mcp_server_instances DROP COLUMN IF EXISTS tools_refreshed_at;
