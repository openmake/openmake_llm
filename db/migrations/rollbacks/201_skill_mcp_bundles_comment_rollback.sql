-- 201 되돌리기 — 021 의 원래 테이블 설명으로 돌린다.
-- 설명만 바뀌므로 코드·데이터에는 영향이 없다.

COMMENT ON TABLE skill_mcp_bundles IS 'MCP server configs bundled with a skill. Spawned by lifecycle-supervisor (per_chat/per_session/long_lived).';
