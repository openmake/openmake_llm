-- addon:extension-marketplace:002 되돌리기 — 레지스트리 사본과 큐레이션을 지운다(다시 켜면 전체 동기화부터 다시 받는다).
-- 이미 MCP 카탈로그로 올린 초안(mcp_server_catalog)은 MCP 런타임 소유라 지우지 않는다.
DROP TABLE IF EXISTS market_registry_sync_state;
DROP TABLE IF EXISTS market_registry_entries;
