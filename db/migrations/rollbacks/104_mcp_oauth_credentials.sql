-- Rollback 104 — 원격 MCP OAuth 자격증명 테이블 제거
DROP TABLE IF EXISTS mcp_oauth_credentials;
