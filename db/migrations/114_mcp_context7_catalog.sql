-- ============================================================
-- 114_mcp_context7_catalog.sql — Context7 MCP 서버를 mcp_server_catalog 에 시드
-- ============================================================
-- 목적: Upstash Context7(https://github.com/upstash/context7) 공식 MCP 서버
--       (@upstash/context7-mcp)를 카탈로그에 추가한다. 라이브러리·프레임워크의 **최신 버전
--       문서·코드 예제**를 질의 시점에 가져와 학습 데이터의 낡은 API 로 인한 환각을 줄인다.
--       도구 2종 — resolve-library-id(이름 → Context7 라이브러리 ID)·query-docs(ID + 질문 → 문서).
--
-- 인증: CONTEXT7_API_KEY (선택). 없어도 동작하나 rate limit 이 낮다. context7.com/dashboard 에서
--       무료 발급. env_schema secret=true 라 입력 시 AES-256-GCM 암호화 저장.
--       ⚠️ CLI `--api-key` 인자는 쓰지 않는다 — ps 노출. env 만.
--
-- 전송: stdio. mcp-runtime 이미지의 npx 로 spawn(버전 고정 4.0.5). 외부 context7.com 호출이라
--       sandbox_network 기본값('full'). 원격 https://mcp.context7.com/mcp 는 Bearer 헤더가 필요한데
--       이 배포의 원격 MCP 는 헤더 주입 미지원 → stdio.
--
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-context7',
    'Context7 (라이브러리 최신 문서)',
    '라이브러리·프레임워크의 최신 버전 문서와 코드 예제를 질의 시점에 조회(resolve-library-id → query-docs). 코딩 질문의 낡은 API 환각 방지. API 키 선택(없으면 rate limit 낮음).',
    'stdio',
    'npx -y @upstash/context7-mcp@4.0.5',
    '{}'::jsonb,
    '{"type": "object", "required": [], "properties": {"CONTEXT7_API_KEY": {"type": "string", "title": "Context7 API Key (선택)", "secret": true, "description": "context7.com/dashboard 에서 무료 발급. 없어도 동작하지만 rate limit 이 낮음"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
