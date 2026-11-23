-- 201: skill_mcp_bundles 테이블 설명을 실제 동작에 맞춘다
--
-- 021 의 COMMENT 는 "lifecycle-supervisor 가 spawn 한다" 고 적었지만 그런 코드는 없다.
-- 매니페스트의 mcp_bundles 는 검증 뒤 기록만 되고 MCP 서버를 띄우지 않는다(의도 —
-- 업로드 스킬이 임의 command 로 프로세스를 띄우면 MCP 카탈로그 검수·확장 권한 심사를 건너뛴다).
-- 스키마 변경 없음 — 설명만 바꾼다. 멱등.

COMMENT ON TABLE skill_mcp_bundles IS
    'MCP server declarations from a skill manifest. Recorded only — never spawned (no reader; install MCP servers via the MCP catalog or extensions). See addons/skill-runtime/mcp-bundles-notice.ts.';
