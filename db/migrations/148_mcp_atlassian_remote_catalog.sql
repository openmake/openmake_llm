-- ============================================================
-- 148_mcp_atlassian_remote_catalog.sql — Atlassian 원격 MCP(Jira·Confluence) 카탈로그 시드 (첫 원격 시드)
-- ============================================================
-- 목적: F21.3(Confluence)·F21.5(Jira) — Atlassian 공식 원격 MCP 서버를 카탈로그에 추가한다.
--       stdio 가 아니라 원격(streamable-http) + OAuth — 설치하면 카드가 auth_required 로 뜨고
--       "로그인" 으로 mcp_oauth_credentials(104) 경로를 탄다. 코드 변경 없이 시드만으로 동작해야 한다.
--
-- 스파이크(2026-09-17, 무인증 탐침):
--   - POST https://mcp.atlassian.com/v1/mcp → 401 `WWW-Authenticate: Bearer realm="OAuth"` (/v1/sse 도 401)
--   - /.well-known/oauth-protected-resource 는 404 — SDK 는 서버 origin 을 인가 서버로 폴백
--   - /.well-known/oauth-authorization-server → registration_endpoint(/v1/register) 있음 = RFC 7591 동적 등록 지원,
--     PKCE S256, token_endpoint_auth_methods none 허용 → 사전 등록 client_id 불필요(계획 R-3 비해당)
--   - 로그인·도구 목록은 사용자 Atlassian 계정이 있어야 확인 가능 → 미확인
--
-- ⚠️ is_enabled = FALSE 로 시드한다 — 관리자가 계정으로 설치→로그인→도구 1개 호출까지 확인한 뒤
--    관리자 카탈로그 화면에서 켠다(122 규칙: 실제 동작 확인 후 노출). 도구 수를 확인하면 tool_allowlist 도 그때 채운다.
--
-- 전송: streamable-http, url_template 고정(치환 인자 없음), command_template NULL, env/args 스키마 빈 객체.
-- 멱등: ON CONFLICT (id) DO NOTHING — 관리자가 켠 상태·수정한 설명을 덮어쓰지 않는다.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, url_template, is_enabled
) VALUES (
    'mcp-atlassian-remote',
    'Atlassian (Jira·Confluence)',
    'Atlassian 공식 원격 MCP — Jira 이슈·Confluence 페이지 조회·작성. 설치 후 커넥터 카드의 로그인으로 Atlassian 계정을 연결(OAuth). API 키 입력 없음.',
    'streamable-http',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    'https://mcp.atlassian.com/v1/mcp',
    FALSE
)
ON CONFLICT (id) DO NOTHING;
