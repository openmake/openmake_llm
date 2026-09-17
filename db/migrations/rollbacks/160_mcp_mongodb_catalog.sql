-- 160 롤백 — 사용자 설치분(mcp_servers.catalog_template_id)은 남는다: 먼저 삭제 여부를 확인할 것
DELETE FROM mcp_server_catalog WHERE id = 'mcp-mongodb';
