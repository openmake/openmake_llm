-- ============================================================
-- 113_mcp_sentry_catalog.sql — Sentry MCP 서버를 mcp_server_catalog 에 시드
-- ============================================================
-- 목적: Sentry 공식 MCP 서버(@sentry/mcp-server, https://github.com/getsentry/sentry-mcp)를
--       카탈로그에 추가한다. 이슈·이벤트·트레이스·프로젝트 조회와 Seer 자동 원인분석 등
--       디버깅 워크플로 도구(스킬 단위: inspect·triage·seer 등)를 제공한다.
--
-- 인증: SENTRY_ACCESS_TOKEN — Sentry User Auth Token (settings/account/api/auth-tokens).
--       필요 scope: org:read, project:read, project:write, team:read, team:write, event:write.
--       env_schema secret=true 라 설치 시 AES-256-GCM 으로 암호화되어 mcp_servers.env 에 저장.
--       ⚠️ README 의 `--access-token=` CLI 인자 방식은 쓰지 않는다 — ps 에 토큰이 노출된다(PR #389
--       교훈). env 만 사용.
--
-- 선택: SENTRY_HOST(self-hosted 호스트명만, 예 sentry.example.com — SaaS 면 비움) ·
--       MCP_DISABLE_SKILLS(예 seer — self-hosted 미지원 스킬 제외).
--       AI 검색 도구(search_events/search_issues)는 서버 자체가 LLM 키(OPENAI_API_KEY 등 +
--       EMBEDDED_AGENT_PROVIDER)를 요구한다 — 이 배포의 로컬 LLM 은 못 붙이므로 기본은 미설정
--       (해당 도구만 동작 안 함, 나머지 정상). 필요 시 EMBEDDED_AGENT_PROVIDER + 해당 키를 추가.
--
-- 전송: stdio. mcp-runtime 이미지의 npx 로 spawn(버전 고정 0.39.0). 외부 sentry.io 호출이라
--       sandbox_network 기본값('full'). 원격 https://mcp.sentry.dev/mcp 는 `Sentry-Bearer`
--       커스텀 헤더가 필요한데 이 배포의 원격 MCP 는 헤더 주입을 지원하지 않아 stdio 를 택했다.
--
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-sentry',
    'Sentry',
    'Sentry 이슈·이벤트·트레이스·프로젝트 조회와 Seer 원인분석 등 디버깅 도구. Sentry User Auth Token 필요(org:read·project:read/write·team:read/write·event:write).',
    'stdio',
    'npx -y @sentry/mcp-server@0.39.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["SENTRY_ACCESS_TOKEN"], "properties": {"SENTRY_ACCESS_TOKEN": {"type": "string", "title": "Sentry Auth Token", "secret": true, "description": "sentry.io Settings > Account > API > Auth Tokens 에서 발급(sntryu_...). scope: org:read, project:read, project:write, team:read, team:write, event:write"}, "SENTRY_HOST": {"type": "string", "title": "Self-hosted 호스트(선택)", "description": "self-hosted Sentry 호스트명만(예: sentry.example.com). SaaS(sentry.io)면 비워 둠"}, "MCP_DISABLE_SKILLS": {"type": "string", "title": "비활성 스킬(선택)", "description": "콤마 구분(예: seer). self-hosted 에서 미지원 스킬 제외"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
