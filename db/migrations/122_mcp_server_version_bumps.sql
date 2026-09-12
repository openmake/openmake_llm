-- 122: MCP stdio 서버 고정 버전 상향 (2026-09-12)
--
-- 카탈로그 템플릿과 이미 설치된 인스턴스의 npx 고정 버전을 최신으로 올린다.
-- 대상은 **운영 샌드박스(읽기 전용 rootfs · cap-drop ALL · net)와 동일한 조건에서
-- 실제 연결·도구 목록을 확인한 것만**이다:
--   · @upstash/context7-mcp        4.0.5      → 4.1.0       (도구 2종 동일: resolve-library-id, query-docs)
--   · @modelcontextprotocol/server-filesystem 2026.7.10 → 2026.8.31 (도구 14종 동일)
--
-- ⚠️ @playwright/mcp 0.0.79 → 0.0.80 은 **의도적으로 제외**한다. 0.0.80 은 번들 playwright 가
--    1.63.0-alpha-2026-08-05 → -08-31 로 올라가며 chromium 리비전이 1237 → 1243 으로 바뀌는데,
--    같은 샌드박스 조건에서 1243 은 브라우저 기동이 "Chromium sandboxing failed!" 로 실패했다
--    (같은 하네스에서 0.0.79 는 example.com 탐색 성공 — 실측 대조). 캐시 볼륨에 1243 을 설치해도
--    동일하게 실패하므로 상류가 고칠 때까지 0.0.79 를 유지한다.
--
-- 설치 인스턴스는 **옛 고정 버전과 정확히 일치하는 행만** 갱신한다(사용자가 손댄 args 보존).

-- 1) 카탈로그 템플릿
UPDATE mcp_server_catalog
   SET command_template = 'npx -y @upstash/context7-mcp@4.1.0'
 WHERE command_template = 'npx -y @upstash/context7-mcp@4.0.5';

UPDATE mcp_server_catalog
   SET command_template = 'npx -y @modelcontextprotocol/server-filesystem@2026.8.31'
 WHERE command_template = 'npx -y @modelcontextprotocol/server-filesystem@2026.7.10';

-- 2) 설치된 인스턴스 args
UPDATE mcp_servers
   SET args = '["-y","@upstash/context7-mcp@4.1.0"]'::jsonb,
       updated_at = NOW()
 WHERE command = 'npx'
   AND args = '["-y","@upstash/context7-mcp@4.0.5"]'::jsonb;

UPDATE mcp_servers
   SET args = '["-y","@modelcontextprotocol/server-filesystem@2026.8.31"]'::jsonb,
       updated_at = NOW()
 WHERE command = 'npx'
   AND args = '["-y","@modelcontextprotocol/server-filesystem@2026.7.10"]'::jsonb;
