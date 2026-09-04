-- ============================================================
-- 112_mcp_tavily_catalog.sql — Tavily MCP 서버를 mcp_server_catalog 에 시드
-- ============================================================
-- 목적: Tavily 공식 MCP 서버(tavily-mcp, https://github.com/tavily-ai/tavily-mcp)를
--       카탈로그에 추가한다. 도구 5종(0.2.22 실측) — tavily_search(실시간 웹검색)·tavily_extract
--       (페이지 본문 추출)·tavily_map(사이트 구조)·tavily_crawl(크롤링)·tavily_research(종합 리서치).
--       ⚠️ 도구명은 README 표기(tavily-search)와 달리 밑줄이다 — 채팅 노출명 `tavily::tavily_search`.
--       설치 시 입력한 TAVILY_API_KEY 는 env_schema 의 secret=true 규약에 따라
--       token-crypto AES-256-GCM 으로 암호화되어 mcp_servers.env 에 저장된다.
--
-- 인증: TAVILY_API_KEY (tvly-...). app.tavily.com 에서 발급. 무료 플랜 월 1,000 크레딧
--       (search basic 1 / advanced 2, extract 페이지당 1). ⚠️ 앱의 Deep Research 보강용
--       system_settings.TAVILY_API_KEY 와는 별개 — 이 MCP 는 사용자 BYOK 로 동작한다.
--
-- 선택: DEFAULT_PARAMETERS — 모든 요청에 합칠 기본 파라미터 JSON
--       (예: {"search_depth":"basic","max_results":10}). 비밀 아님.
--
-- 전송: stdio. mcp-runtime 이미지의 npx 로 spawn(버전 고정 0.2.22 — @latest 는 재현성 없음).
--       외부 api.tavily.com 을 호출하므로 sandbox_network 기본값('full') 사용.
--       원격 https://mcp.tavily.com/mcp (OAuth/Bearer) 도 있으나, 이 배포는 stdio+docker
--       샌드박스 격리가 표준이라 stdio 를 택했다.
--
-- 멱등: ON CONFLICT (id) DO NOTHING — 기존 row(admin 수정 포함)를 덮어쓰지 않음.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-tavily',
    'Tavily Search',
    'Tavily 실시간 웹검색·페이지 추출·사이트 맵·크롤링·종합 리서치(tavily_search/extract/map/crawl/research). Tavily API 키 필요(무료 월 1,000 크레딧).',
    'stdio',
    'npx -y tavily-mcp@0.2.22',
    '{}'::jsonb,
    '{"type": "object", "required": ["TAVILY_API_KEY"], "properties": {"TAVILY_API_KEY": {"type": "string", "title": "Tavily API Key", "secret": true, "description": "app.tavily.com 에서 발급(tvly-...). 무료 플랜 월 1,000 크레딧"}, "DEFAULT_PARAMETERS": {"type": "string", "title": "기본 파라미터(JSON, 선택)", "description": "모든 요청에 합칠 기본값 JSON. 예: {\"search_depth\":\"basic\",\"max_results\":10}"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
