-- ============================================================
-- 161_mcp_circleci_catalog.sql — CircleCI MCP 서버 카탈로그 시드 (S2 커넥터 확장)
-- ============================================================
-- 목적: CI/CD 카테고리 — CircleCI 파이프라인·워크플로우·잡 조회 및 실패 로그 분석.
--       CircleCI 공식(CircleCI-Public 조직, repository CircleCI-Public/mcp-server-circleci 확인)
--       패키지 @circleci/mcp-server-circleci 사용(2026-09-17 npm 조회 dist-tags.latest=0.20.0).
--
-- 인증: CIRCLECI_TOKEN — CircleCI Personal API 토큰(app.circleci.com/settings/user/tokens 에서 발급).
--       공식 문서가 "토큰은 환경변수로만 전달, CLI 인자 미지원"이라고 명시. CIRCLECI_BASE_URL(선택,
--       기본 https://circleci.com)로 온프레미스/Server 인스턴스 지정 가능.
--
-- 전송: stdio. mcp-runtime 이미지의 npx 로 spawn(버전 고정 0.20.0). 외부 circleci.com API 를
--       호출하므로 sandbox_network 기본값('full') 사용.
--
-- ⚠️ is_enabled = FALSE — 관리자가 토큰 발급 후 카탈로그에서 설치→도구 1개 호출 확인한 뒤 켠다.
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-circleci',
    'CircleCI',
    'CircleCI 파이프라인·워크플로우·잡 상태 조회, 실패 로그 분석·재실행. CircleCI Personal API 토큰 필요.',
    'stdio',
    'npx -y @circleci/mcp-server-circleci@0.20.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["CIRCLECI_TOKEN"], "properties": {"CIRCLECI_TOKEN": {"type": "string", "title": "CircleCI Personal API Token", "secret": true, "description": "app.circleci.com/settings/user/tokens 에서 발급"}, "CIRCLECI_BASE_URL": {"type": "string", "title": "CircleCI Base URL(선택)", "description": "온프레미스/CircleCI Server 사용 시 지정. 기본값 https://circleci.com"}}}'::jsonb,
    FALSE
)
ON CONFLICT (id) DO NOTHING;
