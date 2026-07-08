-- 059: Brave Search MCP 서버를 deprecated 참조 구현 → Brave 공식 후속 패키지로 교체.
--
-- 문제: @modelcontextprotocol/server-brave-search (v0.6.2) 는 2025 년 npm 에서 공식
--       deprecated("no longer supported") 되었고 유지보수가 종료됐다. Brave 가 직접
--       유지하는 후속 패키지 @brave/brave-search-mcp-server (v2.0.85) 가 대체한다.
--
-- 호환성(라이브 spawn 검증 완료):
--   - env 변수 동일: BRAVE_API_KEY (기존 암호화 env 그대로 재사용 → env_schema 유지)
--   - 주력 도구명 유지: brave_web_search (+ image/video/news 도구 추가)
--   - 실행: stdio transport 를 명시(`--transport stdio`) — mcp-runtime 이미지의 npx 로 동작
--
-- 범위: ① 카탈로그 템플릿(mcp-brave-search) ② 이미 설치된 user 서버 row(들).
--       051/052 는 카탈로그만 고쳐 재설치를 요구했으나, 여기서는 live 서버가 deprecated
--       패키지를 계속 spawn 하므로 설치 row 의 args 도 함께 교체한다. env/id/user_id/
--       visibility 등 다른 컬럼은 건드리지 않는다(암호화된 BRAVE_API_KEY 보존).
--       패키지명이 바뀌므로 npx/캐시는 새 패키지를 새로 받는다(stale 캐시 문제 없음).
--
-- 멱등: 이미 교체됐으면 두 UPDATE 모두 no-op.

-- ① 카탈로그 템플릿 교체
UPDATE mcp_server_catalog
   SET command_template = 'npx -y @brave/brave-search-mcp-server --transport stdio'
 WHERE id = 'mcp-brave-search'
   AND command_template = 'npx -y @modelcontextprotocol/server-brave-search';

-- ② 이미 설치된 서버 row(들)의 args 교체 (deprecated 패키지를 참조하는 것만)
UPDATE mcp_servers
   SET args = '["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]'::jsonb,
       updated_at = NOW()
 WHERE command = 'npx'
   AND args @> '["@modelcontextprotocol/server-brave-search"]'::jsonb;
