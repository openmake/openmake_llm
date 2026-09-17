-- ============================================================
-- 153_mcp_github_remote_catalog.sql — GitHub 공식 원격 MCP 카탈로그 시드 (계획 C-1 잔여, 비활성)
-- ============================================================
-- 스파이크(2026-09-17, 무인증 탐침):
--   - POST https://api.githubcopilot.com/mcp/ → 401, resource_metadata=/.well-known/oauth-protected-resource/mcp/
--   - 보호 리소스 메타: authorization_servers=[https://github.com/login/oauth], scopes_supported=repo·read:org·read:user·…
--   - 인가 서버 메타(/.well-known/oauth-authorization-server/login/oauth): registration_endpoint 없음(동적 등록 불가),
--     PKCE S256 → **사전 등록 OAuth 클라이언트가 필요**(계획 R-3, 155 mcp_catalog_oauth_clients)
--
-- 켜는 순서(관리자): GitHub 에서 OAuth App 생성(Authorization callback URL = 커넥터 OAuth 콜백 URL,
--   관리자 카탈로그 화면의 OAuth 클라이언트 설정에 표시) → client_id·secret·scope("repo read:org read:user" 권장) 입력
--   → 설치→로그인→도구 1개 호출 확인 → is_enabled 켬(122 규칙).
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, url_template, is_enabled
) VALUES (
    'mcp-github-remote',
    'GitHub',
    'GitHub 공식 원격 MCP — 저장소·이슈·PR 조회·작성. 설치 후 커넥터 카드의 로그인으로 GitHub 계정을 연결(OAuth). 관리자가 GitHub OAuth App 을 등록해야 로그인할 수 있다.',
    'streamable-http',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    'https://api.githubcopilot.com/mcp/',
    FALSE
)
ON CONFLICT (id) DO NOTHING;
