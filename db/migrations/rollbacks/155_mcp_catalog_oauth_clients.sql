-- 155 롤백 — 등록한 OAuth 클라이언트(암호화 secret 포함)가 함께 사라진다: provider 콘솔 값으로 다시 입력해야 한다
DROP TABLE IF EXISTS mcp_catalog_oauth_clients;
