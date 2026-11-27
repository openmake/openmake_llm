-- 롤백: addon:mcp-runtime:001 — 관측 기록만 지운다(연결 동작과 무관).
DROP TABLE IF EXISTS mcp_negotiation_observations;
