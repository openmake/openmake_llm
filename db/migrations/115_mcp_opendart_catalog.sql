-- ============================================================
-- 115_mcp_opendart_catalog.sql — OpenDART(금융감독원 전자공시) MCP 서버를 mcp_server_catalog 에 시드
-- ============================================================
-- 목적: 금융/경제·비즈니스 에이전트가 상장기업 공시·재무제표를 1차 자료(DART)로 인용할 수 있게
--       opendart-mcp(PyPI, https://github.com/RealYoungk/opendart-mcp)를 카탈로그에 추가한다.
--       OpenDART Open API 83개를 도구 1:1 로 노출(공시검색·기업개황·정기보고서 주요사항·
--       재무제표(XBRL 주요계정/전체/지표)·지분공시·주요사항보고서·증권신고서).
--
-- 후보 비교(2026-09-08, 운영과 같은 readonly·512m 샌드박스 실측):
--   · korean-dart-mcp(npm, 회사명→corp_code 변환 포함) — 첫 기동에 corpCode 전체 XML(11.9만사)을
--     DOM 으로 파싱해 **RSS 1.75GiB**(V8 heap 기본 512MB 초과로 abort, 512m 캡에선 OOM kill).
--     4GiB Docker VM 의 사용자별 샌드박스엔 부적합 → 제외.
--   · @vertical-mcp/dart-mcp(도구 3) — 기능 빈약. korea-stock-mcp — 샌드박스에서 무응답.
--   · opendart-mcp — 기동 수 초·메모리 소폭, 83 도구 정상. 단 **회사명→고유번호 변환 도구가 없다**
--     (get_corp_code 는 전체 ZIP base64). 라이브 채팅에서 코드를 아는 회사(삼성전자)는 정상 조회,
--     모르는 회사는 모델이 corp_code 를 사용자에게 되묻는다(날조 없음). 알려진 제약으로 기록.
--
-- 노출 제한: tool_allowlist 8종 — 채팅 자동 노출 상한(CHAT_USER_MCP_TOOL_CAP=8)에 맞춘 핵심 도구.
--       나머지 75개는 mcp_list_tools/mcp_call 진행적 공개와 REST 직접 실행으로 도달 가능
--       (allowlist 는 채팅 자동 노출 그룹에만 적용 — tool-router.getUserPoolToolGroups 참고).
--
-- 인증: OPENDART_API_KEY (필수). opendart.fss.or.kr 「인증키 신청/관리」에서 즉시 무료 발급(40자 hex),
--       일 20,000건. env_schema secret=true → AES-256-GCM 암호화 저장. CLI 인자 전달 없음(ps 노출 방지).
--
-- 전송: stdio. mcp-runtime 이미지의 uvx 로 spawn(버전 고정 0.1.0). 외부 opendart.fss.or.kr 호출이라
--       sandbox_network 기본값('full').
--       ⚠️ `--with mcp<2` 필수 — 패키지가 `mcp[cli]>=1.0.0` 으로 상한을 안 잡아 mcp 2.x 에서
--          `mcp.server.fastmcp` import 로 즉사한다(실측, noapi-google-search 와 같은 패턴).
--          command_template 은 공백 split 이라 따옴표 없이 `mcp<2` 한 토큰으로 쓴다.
--
-- 멱등: ON CONFLICT (id) DO NOTHING — 기존 row(admin 수정 포함)를 덮어쓰지 않음.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, tool_allowlist, is_enabled
) VALUES (
    'mcp-opendart',
    'OpenDART (금융감독원 전자공시)',
    '상장기업 공시 검색·기업개황·재무제표(XBRL 주요계정/전체/재무지표)·배당·최대주주·대량보유 등 OpenDART API 83종. 조회는 corp_code(8자리 고유번호) 기준 — 회사명 검색은 미지원(dart.fss.or.kr 에서 확인). OpenDART 인증키 필요(무료, 일 20,000건).',
    'stdio',
    'uvx --with mcp<2 opendart-mcp==0.1.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["OPENDART_API_KEY"], "properties": {"OPENDART_API_KEY": {"type": "string", "title": "OpenDART API Key", "secret": true, "description": "opendart.fss.or.kr 「인증키 신청/관리」에서 무료 발급(40자). 일 20,000건"}}}'::jsonb,
    '["search_disclosure","get_company_info","get_single_company_accounts","get_single_financial_index","get_full_financial_statement","get_dividend_info","get_largest_shareholder","get_major_stockholding"]'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
