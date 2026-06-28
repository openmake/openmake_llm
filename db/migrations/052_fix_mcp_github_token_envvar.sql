-- 052: mcp-github 카탈로그 env 변수명 수정 (GITHUB_TOKEN → GITHUB_PERSONAL_ACCESS_TOKEN).
--
-- 문제: @modelcontextprotocol/server-github 는 PAT 를 env 변수 GITHUB_PERSONAL_ACCESS_TOKEN
--       에서 읽는데, 023 seed 는 env_schema 키를 GITHUB_TOKEN 으로 설정. 사용자가 토큰을
--       넣어도 컨테이너에 GITHUB_TOKEN 으로만 주입돼 server-github 가 못 읽음 → 비인증으로
--       동작(공개 데이터만, private repo 0). (라이브 검증: GITHUB_TOKEN→private total_count 0,
--       GITHUB_PERSONAL_ACCESS_TOKEN→private total_count 3)
--
-- 수정: env_schema 의 property 키와 required 를 GITHUB_PERSONAL_ACCESS_TOKEN 으로 교체.
--       기존 설치된 user 서버(GITHUB_TOKEN env)는 재설치 필요(snapshot).
--
-- 멱등: 이미 교체됐으면 no-op.

UPDATE mcp_server_catalog
   SET env_schema = '{"type":"object","properties":{"GITHUB_PERSONAL_ACCESS_TOKEN":{"type":"string","title":"GitHub PAT","description":"github.com/settings/tokens 에서 발급","secret":true}},"required":["GITHUB_PERSONAL_ACCESS_TOKEN"]}'::jsonb
 WHERE id = 'mcp-github'
   AND (env_schema->'properties') ? 'GITHUB_TOKEN';
