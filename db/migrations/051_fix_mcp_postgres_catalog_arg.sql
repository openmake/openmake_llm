-- 051: mcp-postgres 카탈로그 템플릿 — connection string 을 위치 인자로 전달하도록 수정.
--
-- 문제: @modelcontextprotocol/server-postgres (deprecated v0.6.2) 는 DB URL 을
--       위치 인자(argv[2]) 로 받는데, 028 seed 는 env(DATABASE_URL) 로 설정해
--       "Please provide a database URL as a command-line argument" 로 spawn 실패했다.
--
-- 수정: command_template 에 {{env.DATABASE_URL}} placeholder 추가. lifecycle-supervisor
--       safeSpawn 이 spawn 시점에 복호화된 env 값으로 치환한다(secret 은 여전히
--       env_schema 로 암호화 저장 — args 평문 저장 없음). env_schema 는 그대로 유지.
--
-- 멱등: 동일 command_template 이면 no-op.

UPDATE mcp_server_catalog
   SET command_template = 'npx -y @modelcontextprotocol/server-postgres {{env.DATABASE_URL}}'
 WHERE id = 'mcp-postgres'
   AND command_template = 'npx -y @modelcontextprotocol/server-postgres';
