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
--
-- 꺼진 채로 심는다(enabled = FALSE). 실행 파일 `noapi-google-search-mcp` 는 호스트에도 openmake-mcp-runtime
-- 이미지에도 없어, 켠 채로 심으면 새 설치본이 기동 때마다 연결에 실패하고 재연결을 10회 반복했다.
-- 웹 검색은 SearXNG 로 되므로 기능 공백은 없다. 쓰려면 MCP 서버 화면에서 명령을
--   command: uvx   args: ["--with", "mcp<2", "noapi-google-search-mcp"]
-- 로 바꾸고 켠다(첫 연결 때 패키지를 받는다. 브라우저 도구는 서버 캐시 볼륨에 chromium 설치가 더 필요하다).
-- 이 파일은 빈 DB 의 첫 기동에만 실행된다. 손으로 다시 돌려도 켜고 끈 상태는 덮어쓰지 않는다.
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
    FALSE
) ON CONFLICT (name) DO UPDATE SET
    command = EXCLUDED.command,
    env = EXCLUDED.env,
    updated_at = NOW();
