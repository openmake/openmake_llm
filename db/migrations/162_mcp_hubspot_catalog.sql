-- ============================================================
-- 162_mcp_hubspot_catalog.sql — HubSpot MCP 서버 카탈로그 시드 (S2 커넥터 확장)
-- ============================================================
-- 목적: CRM/고객지원 카테고리 — HubSpot CRM 객체(컨택트·딜·컴퍼니 등) 조회·생성·수정.
--       HubSpot 공식(메인테이너가 전원 @hubspot.com 이메일로 확인) 패키지 @hubspot/mcp-server 사용
--       (2026-09-17 npm 조회 dist-tags.latest=0.4.0).
--
-- 인증: PRIVATE_APP_ACCESS_TOKEN — HubSpot Private App Access Token. HubSpot 계정 설정 →
--       Integrations → Private Apps 에서 앱을 만들고 필요한 스코프(CRM 객체 읽기/쓰기 등)를 부여한
--       뒤 발급받는다. 공식 문서가 "토큰은 환경변수로만 전달"한다고 명시.
--
-- 전송: stdio. mcp-runtime 이미지의 npx 로 spawn(버전 고정 0.4.0). 외부 api.hubapi.com 을
--       호출하므로 sandbox_network 기본값('full') 사용.
--
-- ⚠️ is_enabled = FALSE — 관리자가 Private App 생성·토큰 발급 후 카탈로그에서 설치→도구 1개 호출
--    확인한 뒤 켠다.
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-hubspot',
    'HubSpot',
    'HubSpot CRM 컨택트·딜·컴퍼니·티켓 조회·생성·수정. HubSpot Private App Access Token 필요.',
    'stdio',
    'npx -y @hubspot/mcp-server@0.4.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["PRIVATE_APP_ACCESS_TOKEN"], "properties": {"PRIVATE_APP_ACCESS_TOKEN": {"type": "string", "title": "HubSpot Private App Access Token", "secret": true, "description": "HubSpot 계정 설정 → Integrations → Private Apps 에서 발급. 필요한 CRM 스코프를 부여할 것"}}}'::jsonb,
    FALSE
)
ON CONFLICT (id) DO NOTHING;
