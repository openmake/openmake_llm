-- ============================================================
-- 159_mcp_slack_catalog.sql — Slack MCP 서버 카탈로그 시드 (S2 커넥터 확장)
-- ============================================================
-- 목적: 팀 협업 카테고리 — Slack 워크스페이스 채널/메시지 조회·게시.
--       @modelcontextprotocol/server-slack(모델컨텍스트프로토콜 조직 공식 reference 서버,
--       메인테이너 ashwin@anthropic.com 확인, 2026-09-17 npm 조회 dist-tags.latest=2025.4.25) 사용.
--       ⚠️ 상위 reference 서버군(구 modelcontextprotocol/servers)은 이후 servers-archived 로
--       옮겨졌지만 npm 배포는 계속되고 있다 — 대체 공식 서버가 없어 이 패키지를 채택.
--
-- 인증: Slack App(Bot) 을 워크스페이스에 설치해 Bot User OAuth Token(SLACK_BOT_TOKEN, xoxb-...)과
--       워크스페이스 ID(SLACK_TEAM_ID, T...)를 발급받아야 한다. SLACK_CHANNEL_IDS(선택)로 접근 채널을
--       제한할 수 있다(비우면 봇이 속한 모든 공개 채널).
--
-- 전송: stdio. mcp-runtime 이미지의 npx 로 spawn(버전 고정 2025.4.25 — @latest 는 재현성 없음).
--       외부 slack.com API 를 호출하므로 sandbox_network 기본값('full') 사용.
--
-- ⚠️ is_enabled = FALSE — 관리자가 Slack App 생성→설치→로그인 없이 바로 동작(OAuth 아님, 토큰 직접
--    입력)하므로, 토큰 발급 후 카탈로그에서 설치→도구 1개 호출 확인한 뒤 켠다.
-- 멱등: ON CONFLICT (id) DO NOTHING — 기존 row(admin 수정 포함)를 덮어쓰지 않음.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-slack',
    'Slack',
    'Slack 워크스페이스 채널 목록·히스토리 조회, 메시지 게시·스레드 답글·리액션. Slack App(Bot) 생성 후 Bot User OAuth Token 필요.',
    'stdio',
    'npx -y @modelcontextprotocol/server-slack@2025.4.25',
    '{}'::jsonb,
    '{"type": "object", "required": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"], "properties": {"SLACK_BOT_TOKEN": {"type": "string", "title": "Slack Bot User OAuth Token", "secret": true, "description": "api.slack.com/apps 에서 App 생성 후 워크스페이스에 설치해 발급(xoxb-...)"}, "SLACK_TEAM_ID": {"type": "string", "title": "Slack Workspace ID", "description": "워크스페이스 ID(T로 시작)"}, "SLACK_CHANNEL_IDS": {"type": "string", "title": "접근 허용 채널 ID 목록(선택, 쉼표 구분)", "description": "비우면 봇이 속한 모든 공개 채널에 접근"}}}'::jsonb,
    FALSE
)
ON CONFLICT (id) DO NOTHING;
