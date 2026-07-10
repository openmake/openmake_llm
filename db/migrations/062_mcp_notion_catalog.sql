-- ============================================================
-- 062_mcp_notion_catalog.sql — Notion MCP 서버를 mcp_server_catalog 에 시드
-- ============================================================
-- 목적: Notion 워크스페이스의 페이지/데이터소스를 조회·검색·생성·편집할 수 있는
--       공식 MCP 서버(@notionhq/notion-mcp-server)를 카탈로그에 추가한다.
--       사용자는 mcp-github/mcp-brave-search 와 동일하게 카탈로그에서 설치하며,
--       설치 시 입력한 Notion Integration Token(NOTION_TOKEN)은 env_schema 의
--       secret=true 규약에 따라 token-crypto AES-256-GCM 으로 암호화되어
--       mcp_servers.env 에 저장된다(createFromCatalog → encryptEnv).
--
-- 인증: NOTION_TOKEN (공식 v2 권장). notion.so/my-integrations 에서 Internal
--       Integration Token 발급(ntn_...) 후, 편집 대상 페이지를 해당 integration 에
--       공유해야 도구가 접근할 수 있다.
--
-- 전송: stdio (기본). mcp-runtime 이미지의 npx 로 spawn. 외부 Notion API 를
--       호출하므로 mcp_servers.sandbox_network 는 기본값('full') 이 적절하다
--       (createFromCatalog 는 sandbox_network 를 건드리지 않고 DB 컬럼 기본값 사용).
--
-- 도구(공식 서버 v2, Notion API 2025-09-03 기준): create-a-page, update-a-page,
--       update-page-markdown, append-block-children, update-block, move-page,
--       create-a-comment, query-data-source 등. ⚠️ "삭제"는 하드 삭제가 아니라
--       아카이브(휴지통)이며(update-a-page 로 archived 처리), 데이터베이스 삭제는
--       MCP 로 불가하다.
--
-- 멱등: ON CONFLICT (id) DO NOTHING — 기존 row(admin 수정 포함)를 덮어쓰지 않음.
-- ============================================================

-- 주의: required_tier 컬럼은 039_drop_subscription_tiers.sql 로 제거됨(구독/tier 폐기).
--       현재 mcp_server_catalog 스키마에 맞춰 tier 없이 INSERT 한다.
INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-notion',
    'Notion',
    'Notion 워크스페이스 페이지/데이터소스 조회·검색·생성·편집. Notion Integration Token 필요. (삭제는 아카이브(휴지통) 처리)',
    'stdio',
    'npx -y @notionhq/notion-mcp-server',
    '{}'::jsonb,
    '{"type": "object", "required": ["NOTION_TOKEN"], "properties": {"NOTION_TOKEN": {"type": "string", "title": "Notion Integration Token", "secret": true, "description": "notion.so/my-integrations 에서 발급(ntn_...). 편집 대상 페이지를 이 integration 에 공유 필요"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
