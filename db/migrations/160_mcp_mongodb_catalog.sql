-- ============================================================
-- 160_mcp_mongodb_catalog.sql — MongoDB MCP 서버 카탈로그 시드 (S2 커넥터 확장)
-- ============================================================
-- 목적: 데이터베이스/데이터웨어하우스 카테고리 — MongoDB 컬렉션 조회·집계·문서 CRUD.
--       MongoDB 공식(mongodb-js 조직, repository mongodb-js/mongodb-mcp-server 확인) 패키지
--       mongodb-mcp-server 사용(2026-09-17 npm 조회 dist-tags.latest=3.0.2, 최근 배포일 동일).
--
-- 후보였던 @modelcontextprotocol/server-postgres(Anthropic 공식) 는 DB 연결 문자열(비밀번호 포함)을
--       CLI 인자로만 받고 환경변수를 지원하지 않아(코드 확인: `process.argv.slice(2)[0]`) 이 레포의
--       "키는 env_schema, CLI 인자 금지(ps 노출)" 규약과 충돌한다 — 시드에서 제외.
--
-- 인증: MDB_MCP_CONNECTION_STRING — MongoDB 연결 문자열(mongodb://user:pass@host/db 또는 Atlas SRV
--       URI). 공식 문서가 "보안을 위해 CLI 인자 대신 환경변수 사용을 강력 권장"한다고 명시.
--
-- 전송: stdio(기본값, --transport 로 http 전환 가능하나 이 배포는 stdio 고정). mcp-runtime 이미지의
--       npx 로 spawn(버전 고정 3.0.2). 외부 MongoDB 인스턴스/Atlas 를 호출하므로 sandbox_network
--       기본값('full') 사용.
--
-- ⚠️ is_enabled = FALSE — 관리자가 연결 문자열 발급 후 카탈로그에서 설치→도구 1개 호출 확인한 뒤 켠다.
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-mongodb',
    'MongoDB',
    'MongoDB 데이터베이스 컬렉션 조회·집계·문서 CRUD, Atlas 클러스터 관리. MongoDB 연결 문자열 필요.',
    'stdio',
    'npx -y mongodb-mcp-server@3.0.2',
    '{}'::jsonb,
    '{"type": "object", "required": ["MDB_MCP_CONNECTION_STRING"], "properties": {"MDB_MCP_CONNECTION_STRING": {"type": "string", "title": "MongoDB Connection String", "secret": true, "description": "mongodb://user:pass@host:port/db 또는 Atlas SRV URI. 읽기 전용 계정 권장"}}}'::jsonb,
    FALSE
)
ON CONFLICT (id) DO NOTHING;
