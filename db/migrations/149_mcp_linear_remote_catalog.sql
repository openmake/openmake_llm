-- ============================================================
-- 149_mcp_linear_remote_catalog.sql — Linear 원격 MCP 카탈로그 시드
-- ============================================================
-- 목적: F21.5(이슈 트래커) — Linear 공식 원격 MCP 서버. 148 과 같은 원격 + OAuth 형식.
--
-- 스파이크(2026-09-17, 무인증 탐침):
--   - POST https://mcp.linear.app/mcp → 401, WWW-Authenticate 에 resource_metadata 제공(/sse 는 404 — streamable-http 만)
--   - protected-resource 메타데이터: authorization_servers=[https://mcp.linear.app], scopes read·write
--   - 인가 서버 메타데이터: registration_endpoint(/register) 있음 = 동적 등록 지원, PKCE S256
--   - 로그인·도구 목록은 사용자 Linear 계정으로만 확인 가능 → 미확인
--
-- GitHub 원격(https://api.githubcopilot.com/mcp/)은 같은 PR 계획이었으나 제외했다 — 인가 서버가
-- github.com/login/oauth 라 동적 등록이 없고 사전 등록한 OAuth App client_id 가 필요하다(계획 R-3, 155 예약).
--
-- ⚠️ is_enabled = FALSE — 관리자가 설치→로그인→도구 호출 확인 후 켠다(148 과 같은 이유).
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, url_template, is_enabled
) VALUES (
    'mcp-linear-remote',
    'Linear',
    'Linear 공식 원격 MCP — 이슈·프로젝트·사이클 조회와 이슈 생성·수정. 설치 후 커넥터 카드의 로그인으로 Linear 계정을 연결(OAuth). API 키 입력 없음.',
    'streamable-http',
    NULL,
    '{}'::jsonb,
    '{}'::jsonb,
    'https://mcp.linear.app/mcp',
    FALSE
)
ON CONFLICT (id) DO NOTHING;
