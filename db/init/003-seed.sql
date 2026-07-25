-- ============================================
-- OpenMake.Ai - Seed Data
-- ============================================
-- 초기 관리자 계정은 이 파일에서 만들지 않는다 — 고정 비밀번호를 저장소에 두면
-- 모든 배포가 같은 자격증명으로 열리기 때문. 생성은 004-admin-user.sh 가
-- ADMIN_INITIAL_PASSWORD 환경변수를 받아 처리한다.
-- ============================================

-- ============================================
-- 🔌 Default MCP Server: noapi-google-search-mcp
-- Google Search, Lens, Maps, Translate, etc. via headless Chromium
-- No API key required
-- ============================================

INSERT INTO mcp_servers (id, name, transport_type, command, args, env, url, enabled)
VALUES (
    'mcp_noapi_google_search',
    'noapi-google-search',
    'stdio',
    'noapi-google-search-mcp',
    NULL,
    '{"PYTHONUNBUFFERED": "1"}'::jsonb,
    NULL,
    TRUE
) ON CONFLICT (name) DO UPDATE SET
    command = EXCLUDED.command,
    env = EXCLUDED.env,
    enabled = EXCLUDED.enabled,
    updated_at = NOW();
