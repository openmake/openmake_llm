-- ============================================================
-- 075_mcp_notebooklm_catalog.sql — NotebookLM MCP 서버를 카탈로그에 시드
-- ============================================================
-- 목적: Google NotebookLM(notebooklm.google.com)을 채팅에서 호출할 수 있는 MCP
--       서버(jacob-bd/notebooklm-mcp-cli, PyPI)를 카탈로그에 추가한다.
--       노트북 목록/질의(인용 기반 Q&A)/소스 추가/스튜디오 생성(오디오·비디오 등)/
--       리서치/공유 등 39개 도구 제공.
--
-- 선정 근거(2026-07-18 비교 검토): PleasePrompto/notebooklm-mcp(원본)·roomi-fields
--       fork 는 Patchright 로 실제 Chrome 을 구동하는 브라우저 자동화 방식이라
--       ephemeral·무마운트인 MCP 샌드박스(sandbox-docker.ts)에 부적합(컨테이너에
--       Chrome+영속 프로필+noVNC 필요). jacob-bd/notebooklm-mcp-cli 는 쿠키 기반
--       내부 RPC 호출로 런타임 브라우저가 불필요하고 도구 수·유지보수가 가장 앞섬.
--
-- 인증(유저별 Google 로그인): 사용자가 자기 브라우저에서 notebooklm.google.com 에
--       Google 로그인한 뒤 DevTools 요청 헤더의 Cookie 문자열을 설치 폼에 붙여넣는다.
--       env_schema 의 secret=true 규약 → createFromCatalog 가 AES-256-GCM 암호화
--       저장, 사용자별(user_private) 격리. spawn 시 컨테이너에 -e 로만 주입.
--       CSRF 토큰은 쿠키로부터 자동 추출(별도 입력 불필요). 쿠키 수명 2~4주 —
--       만료 시 새 Cookie 값으로 재설치(재연결)한다.
--
-- ⚠️ 사전조건 — mcp-runtime 이미지 재빌드 필요:
--    `docker build -t openmake-mcp-runtime:latest infra/mcp-runtime`.
--    baked 바이너리(/home/node/.local/bin/notebooklm-mcp)는 그 이미지 안에만
--    존재하므로 재빌드 전에는 spawn 이 실패한다(등록 자체는 무해).
--
-- 전송: stdio(기본). NotebookLM 내부 API 호출이 필요하므로 sandbox_network 는
--       DB 기본값('full') 사용(createFromCatalog 는 sandbox_network 미설정).
--
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-notebooklm',
    'NotebookLM',
    'Google NotebookLM 연동 — 내 노트북 질의(인용 기반 Q&A)·소스 추가·오디오/비디오 생성·리서치. 연결: notebooklm.google.com 에 Google 로그인 후 DevTools > Network 요청의 Cookie 헤더 값을 붙여넣기 (수명 2~4주, 만료 시 재연결).',
    'stdio',
    'notebooklm-mcp',
    '{}'::jsonb,
    '{"type": "object", "required": ["NOTEBOOKLM_COOKIES"], "properties": {"NOTEBOOKLM_COOKIES": {"type": "string", "title": "NotebookLM Cookie", "secret": true, "description": "notebooklm.google.com 로그인 상태에서 DevTools > Network > 아무 요청 > Request Headers 의 Cookie 값 전체를 붙여넣기"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
