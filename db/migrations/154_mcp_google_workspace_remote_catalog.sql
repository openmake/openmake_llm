-- ============================================================
-- 154_mcp_google_workspace_remote_catalog.sql — Google Workspace 공식 원격 MCP(Gmail·Calendar·Drive) 시드 (계획 C-3, 비활성)
-- ============================================================
-- C-3-0 스파이크(2026-09-17): Google 이 공식 원격 MCP 를 제공한다(Google Workspace Developer Preview,
--   developers.google.com/workspace/guides/configure-mcp-servers) → 계획의 자체 커넥션(153 external_connections·
--   {{conn.*}} 자리표시자)은 불필요하고, 148 형식 원격 시드로 끝난다.
--   - POST https://gmailmcp.googleapis.com/mcp/v1 initialize·tools/list → 무인증 200(도구 호출에만 토큰 필요)
--   - 보호 리소스 메타(/.well-known/oauth-protected-resource/mcp/v1): authorization_servers=[https://accounts.google.com/],
--     scopes_supported 에 https://mail.google.com/(메일 전체 권한)까지 포함
--   - accounts.google.com 에 registration_endpoint 없음 → **사전 등록 OAuth 클라이언트 필요**(155, R-3)
--
-- 켜는 순서(관리자): Google Cloud 프로젝트에서 Gmail·Calendar·Drive API 와 각 MCP API(gmailmcp 등) 사용 설정,
--   Developer Preview 등록, OAuth 동의 화면, "웹 애플리케이션" 클라이언트(승인된 리디렉션 URI = 커넥터 OAuth 콜백 URL)
--   → 관리자 카탈로그 화면에서 client_id·secret·scope(읽기 전용 권장)·인가 파라미터 access_type=offline, prompt=consent
--   (Google 은 offline_access scope 대신 이 파라미터로 refresh token 을 준다 — 없으면 1시간마다 재로그인)
--   → 설치→로그인→도구 1개 호출 확인 → is_enabled 켬.
-- ⚠️ scope 를 비워 두면 SDK 가 scopes_supported 전체(메일 전체 권한 포함)를 요청한다 — 반드시 최소 scope 를 넣을 것.
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, url_template, is_enabled
) VALUES
(
    'mcp-google-gmail-remote',
    'Gmail',
    'Google 공식 원격 MCP(Developer Preview) — 메일 검색·읽기·초안 작성. 설치 후 커넥터 카드의 로그인으로 Google 계정을 연결(OAuth). 관리자가 Google Cloud OAuth 클라이언트를 등록해야 로그인할 수 있다.',
    'streamable-http', NULL, '{}'::jsonb, '{}'::jsonb,
    'https://gmailmcp.googleapis.com/mcp/v1',
    FALSE
),
(
    'mcp-google-calendar-remote',
    'Google Calendar',
    'Google 공식 원격 MCP(Developer Preview) — 일정 조회·생성. 설치 후 커넥터 카드의 로그인으로 Google 계정을 연결(OAuth). 관리자가 Google Cloud OAuth 클라이언트를 등록해야 로그인할 수 있다.',
    'streamable-http', NULL, '{}'::jsonb, '{}'::jsonb,
    'https://calendarmcp.googleapis.com/mcp/v1',
    FALSE
),
(
    'mcp-google-drive-remote',
    'Google Drive',
    'Google 공식 원격 MCP(Developer Preview) — 파일 검색·읽기. 설치 후 커넥터 카드의 로그인으로 Google 계정을 연결(OAuth). 관리자가 Google Cloud OAuth 클라이언트를 등록해야 로그인할 수 있다.',
    'streamable-http', NULL, '{}'::jsonb, '{}'::jsonb,
    'https://drivemcp.googleapis.com/mcp/v1',
    FALSE
)
ON CONFLICT (id) DO NOTHING;
