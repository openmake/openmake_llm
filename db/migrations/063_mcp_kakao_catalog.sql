-- ============================================================
-- 063_mcp_kakao_catalog.sql — Kakao(Map/Search) MCP 서버를 카탈로그에 시드
-- ============================================================
-- 목적: Kakao Local(지도) + Daum 검색 도구 7종을 제공하는 MCP 서버를 카탈로그에
--       추가한다. 서버는 npm 미배포라 mcp-runtime 이미지에 baked 됐고
--       (infra/mcp-runtime/Dockerfile + vendor/kakao-api-mcp-server), MCP 샌드박스가
--       켜져 있으면 그 컨테이너 안에서 실행된다
--       (sandbox-docker.ts: `docker run ... openmake-mcp-runtime node /home/node/kakao-mcp/... `).
--
-- 도구(7): search-places(장소 키워드검색), coord-to-address(좌표→주소),
--          find-route(길찾기), search-web/image/blog/cafe(Daum 검색).
--          ※ Daum 검색은 기존 웹검색과 일부 중복. find-route 는 원 저장소 기준
--            일부 미완성 가능성 있음.
--
-- 인증: KAKAO_REST_API_KEY (Kakao Developers REST API 키). env_schema 의
--       secret=true 규약 → createFromCatalog 가 AES-256-GCM 암호화 저장,
--       사용자별(user_private) 격리. spawn 시 컨테이너에 -e 로만 주입.
--
-- ⚠️ 사전조건 — mcp-runtime 이미지를 벤더 소스 포함해 재빌드해야 한다:
--    `docker build -t openmake-mcp-runtime:latest infra/mcp-runtime`.
--    baked 경로(/home/node/kakao-mcp/dist/index.js)는 그 이미지 안에만 존재하므로
--    재빌드 전에는 spawn 이 실패한다(등록 자체는 무해).
--
-- 전송: stdio(기본). 외부 Kakao API 호출이 필요하므로 mcp_servers.sandbox_network
--       는 기본값('full') 이 적절(createFromCatalog 는 sandbox_network 미설정 → DB 기본값).
--
-- 주의: required_tier 컬럼은 039_drop_subscription_tiers 에서 제거됨 — INSERT 에서 제외.
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES (
    'mcp-kakao',
    'Kakao (Map/Search)',
    'Kakao 지도(장소검색·좌표→주소·길찾기) + Daum 검색 도구 7종. Kakao REST API 키 필요.',
    'stdio',
    'node /home/node/kakao-mcp/dist/index.js --mode=stdio',
    '{}'::jsonb,
    '{"type": "object", "required": ["KAKAO_REST_API_KEY"], "properties": {"KAKAO_REST_API_KEY": {"type": "string", "title": "Kakao REST API Key", "secret": true, "description": "developers.kakao.com 앱 > REST API 키. 카카오맵/로컬 API 사용 설정 필요"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
