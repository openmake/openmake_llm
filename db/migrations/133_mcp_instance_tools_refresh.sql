-- 133: MCP 도구 목록 갱신 관측 (2026-09-17, F13.12)
-- listChanged 알림 또는 stale 재조회로 도구 목록이 바뀐 시각·개수를 인스턴스 행에 남긴다.
ALTER TABLE mcp_server_instances ADD COLUMN IF NOT EXISTS tools_count INTEGER;
ALTER TABLE mcp_server_instances ADD COLUMN IF NOT EXISTS tools_refreshed_at TIMESTAMPTZ;
COMMENT ON COLUMN mcp_server_instances.tools_count IS '마지막 반영 시점의 도구 수(133)';
COMMENT ON COLUMN mcp_server_instances.tools_refreshed_at IS '마지막 tools/list 반영 시각(listChanged 알림 또는 stale 갱신)(133)';
