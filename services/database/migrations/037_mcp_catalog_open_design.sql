-- ============================================================
-- 037_mcp_catalog_open_design.sql — Open Design MCP 카탈로그 시드
-- ============================================================
-- 목적: 로컬 Open Design 데몬(디자인 워크스페이스)을 외부 MCP 서버로 등록할 수
--       있는 카탈로그 템플릿 추가. 채팅/에이전트 작업이 디자인 토큰·컴포넌트를
--       조회하고(get_artifact/list_projects) 완성 디자인을 워크스페이스에 저장
--       (create_artifact/write_file)하는 UI/UX 디자인 도구로 사용된다.
--
-- command_template 의 절대 경로는 배포 환경(L3 DB 설정) 값 — 다른 머신에 배포
-- 시 admin 콘솔(POST/PUT /admin/mcp/catalog)에서 경로를 수정한다.
--
-- ON CONFLICT (id) DO NOTHING 으로 멱등 — admin 수정 사항 보존.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, required_tier, is_enabled
) VALUES
(
    'open-design',
    'Open Design',
    '로컬 디자인 워크스페이스 (Open Design). 프로젝트의 디자인 토큰·컴포넌트·아티팩트를 조회하고 HTML/JSX/CSS 디자인 산출물을 저장. UI/UX 디자인 작업 시 디자인 언어 일관성 유지에 활용.',
    'stdio',
    '/Users/openmake_mac/.local/share/mise/installs/node/24.16.0/bin/node /Users/openmake_mac/open-design/apps/daemon/dist/cli.js mcp',
    '{}'::jsonb,
    '{"type": "object", "required": ["OD_DATA_DIR"], "properties": {"OD_DATA_DIR": {"type": "string", "title": "데이터 디렉토리", "description": "Open Design 데이터 디렉토리 (기본: /Users/openmake_mac/open-design/.od)"}}}'::jsonb,
    'pro',
    TRUE
)
ON CONFLICT (id) DO NOTHING;
