-- ============================================================
-- 028_mcp_catalog_seed.sql — mcp_server_catalog 인기 MCP 서버 시드
-- ============================================================
-- 목적: 사용자가 즉시 사용 가능한 검증된 MCP 서버 5개를 catalog 에 추가.
--       admin 콘솔이 추가 등록을 담당하지만 기본 시드는 마이그레이션으로.
--
-- ON CONFLICT (id) DO NOTHING 으로 멱등 — 기존 row 덮어쓰지 않음 (admin 의
-- 수정 사항 보존).
--
-- 추가 항목:
--   - mcp-sequential-thinking — free, 추론 보조 (args/env 없음)
--   - mcp-memory               — free, knowledge graph 영구 메모리
--   - mcp-fetch                — free, HTTP fetch 도구 (web_scrape 와 별개)
--   - mcp-postgres             — pro,  DATABASE_URL 필수
--   - mcp-brave-search         — pro,  BRAVE_API_KEY 필수
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, required_tier, is_enabled
) VALUES
(
    'mcp-sequential-thinking',
    'Sequential Thinking',
    '복잡한 추론을 단계별로 분해하는 사고 보조 도구. 분석/계획 작업에 활용.',
    'stdio',
    'npx -y @modelcontextprotocol/server-sequential-thinking',
    '{}'::jsonb,
    '{}'::jsonb,
    'free',
    TRUE
),
(
    'mcp-memory',
    'Memory (Knowledge Graph)',
    '대화 간 영구 기억. 엔티티/관계 그래프로 사용자 컨텍스트 저장.',
    'stdio',
    'npx -y @modelcontextprotocol/server-memory',
    '{}'::jsonb,
    '{}'::jsonb,
    'free',
    TRUE
),
(
    'mcp-fetch',
    'Fetch (HTTP)',
    '간단한 HTTP fetch 도구. URL 콘텐츠 가져오기 (web_scrape 보다 가벼움).',
    'stdio',
    'npx -y @modelcontextprotocol/server-fetch',
    '{}'::jsonb,
    '{}'::jsonb,
    'free',
    TRUE
),
(
    'mcp-postgres',
    'PostgreSQL',
    'PostgreSQL DB 읽기 전용 쿼리. 스키마 조회 + SELECT 실행.',
    'stdio',
    -- server-postgres 는 DB URL 을 위치 인자로 받음 — {{env.DATABASE_URL}} placeholder 를
    -- safeSpawn 이 복호화 env 로 치환(051 마이그레이션과 동일). env_schema 로 암호화 저장.
    'npx -y @modelcontextprotocol/server-postgres {{env.DATABASE_URL}}',
    '{}'::jsonb,
    '{"type": "object", "required": ["DATABASE_URL"], "properties": {"DATABASE_URL": {"type": "string", "title": "PostgreSQL URL", "secret": true, "description": "postgresql://user:pass@host:port/db (read-only 권장)"}}}'::jsonb,
    'pro',
    TRUE
),
(
    'mcp-brave-search',
    'Brave Search',
    'Brave Search API 를 통한 웹 검색. API 키 필요.',
    'stdio',
    'npx -y @modelcontextprotocol/server-brave-search',
    '{}'::jsonb,
    '{"type": "object", "required": ["BRAVE_API_KEY"], "properties": {"BRAVE_API_KEY": {"type": "string", "title": "Brave API Key", "secret": true, "description": "brave.com/search/api 에서 발급"}}}'::jsonb,
    'pro',
    TRUE
)
ON CONFLICT (id) DO NOTHING;
