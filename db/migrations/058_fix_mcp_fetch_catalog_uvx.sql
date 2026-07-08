-- 058: mcp-fetch 카탈로그 command_template 교정 (npx 존재하지 않는 패키지 → uvx).
--
-- 문제: 028 seed 는 mcp-fetch command_template 을 'npx -y @modelcontextprotocol/server-fetch'
--       로 설정했으나, 이 npm 패키지는 존재하지 않는다(registry 404). fetch 참조 구현은
--       PyPI 의 'mcp-server-fetch'(uvx) 뿐이다. 실제로 이미 설치된 user 서버 'mcp-fetch' 는
--       올바르게 `uvx mcp-server-fetch` 를 쓰지만, 카탈로그에서 신규 설치하면 깨진 npx
--       템플릿이 그대로 snapshot 되어 spawn 실패한다.
--
-- 수정: command_template 을 'uvx mcp-server-fetch' 로 교체. uvx 는 mcp-runtime 이미지에
--       포함되어 있고, PyPI 최신(2026.6.4)을 온디맨드로 받아 stdio 로 동작한다.
--       transport_type(stdio)·env_schema 는 그대로 유지.
--
-- 멱등: 이미 uvx 로 교체됐으면 no-op.

UPDATE mcp_server_catalog
   SET command_template = 'uvx mcp-server-fetch'
 WHERE id = 'mcp-fetch'
   AND command_template = 'npx -y @modelcontextprotocol/server-fetch';
