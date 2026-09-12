-- 123: server-filesystem 미고정 시드도 2026.8.31 로 고정 (122 보완, /code-review #854 지적)
--
-- 122 는 '@2026.7.10' 고정 형태만 매치해 운영 DB(수동으로 고정돼 있던 행)는 갱신됐지만,
-- 신규 설치는 023 시드가 **버전 미고정**('npx -y @modelcontextprotocol/server-filesystem')이라
-- 122 의 WHERE 에 걸리지 않아 npx 가 매 spawn 마다 latest 로 해석된다(재현성 없음).
-- 미고정 형태를 운영과 같은 2026.8.31 로 고정한다. 122 는 이미 적용된 마이그레이션이라
-- (checksum 이력) 수정하지 않고 별도 파일로 둔다. 멱등.

UPDATE mcp_server_catalog
   SET command_template = 'npx -y @modelcontextprotocol/server-filesystem@2026.8.31'
 WHERE command_template = 'npx -y @modelcontextprotocol/server-filesystem';

UPDATE mcp_servers
   SET args = '["-y","@modelcontextprotocol/server-filesystem@2026.8.31"]'::jsonb,
       updated_at = NOW()
 WHERE command = 'npx'
   AND args = '["-y","@modelcontextprotocol/server-filesystem"]'::jsonb;
