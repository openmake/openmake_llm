-- ============================================================
-- 116_mcp_data_go_kr_catalog.sql — 공공데이터포털(data.go.kr) MCP 서버 4종을 mcp_server_catalog 에 시드
-- ============================================================
-- 목적: 금융/경제·비즈니스·공공/정부 에이전트가 공공데이터를 1차 자료로 인용할 수 있게
--       Koomook/data-go-mcp-servers(PyPI, Apache-2.0, API 별 패키지)를 카탈로그에 추가한다.
--       메타형(포털 전체 API 검색·호출)은 신뢰할 게시본이 없어(npm 미게시·제3자 백엔드 경유) API 별
--       패키지를 채택했다(2026-09-08 조사). 4종 모두 운영과 같은 readonly·512m 샌드박스에서
--       initialize·tools/list 실측 통과.
--
--   mcp-datago-fsc   금융위원회 기업 재무정보      — 도구 4 (요약 재무제표·재무상태표·손익계산서·통합조회, 법인등록번호 기준)
--   mcp-datago-nts   국세청 사업자등록정보 진위확인 — 도구 3 (진위확인·상태조회·일괄확인)
--   mcp-datago-pps   조달청 나라장터 입찰·낙찰·계약   — 도구 4 (입찰공고·낙찰·계약 검색·입찰 상세)
--   mcp-datago-nps   국민연금 가입 사업장 내역      — 도구 3 (사업장 검색·상세·기간별 현황)
--
-- 인증: API_KEY (필수) = 공공데이터포털 계정의 일반 인증키(**Decoding** 키). ⚠️ 키 하나로 되지 않는다 —
--       포털에서 **해당 API 를 개별 「활용신청」** 해야 한다(대부분 자동승인, 일부 1~2일). 미신청 API 는
--       키가 있어도 오류. env_schema secret=true → AES-256-GCM 암호화 저장. CLI 인자 전달 없음.
--
-- 전송: stdio. mcp-runtime 이미지의 uvx 로 spawn(버전 고정). 외부 apis.data.go.kr 호출이라
--       sandbox_network 기본값('full').
--       ⚠️ `--with mcp<2` 필수 — 패키지가 mcp 상한을 안 잡아(`mcp[cli]>=1.13.0`) mcp 2.x 에서
--          `Server.list_tools` 부재로 즉사(실측). command_template 은 공백 split 이라 따옴표 없이 한 토큰.
--
-- 멱등: ON CONFLICT (id) DO NOTHING.
-- ============================================================

INSERT INTO mcp_server_catalog (
    id, display_name, description, transport_type, command_template,
    args_schema, env_schema, is_enabled
) VALUES
(
    'mcp-datago-fsc',
    '공공데이터 · 금융위원회 기업 재무정보',
    '법인등록번호로 기업의 요약 재무제표·재무상태표·손익계산서를 조회(get_summary_financial_statement/get_balance_sheet/get_income_statement/search_company_financial_info). data.go.kr 인증키 + 「금융위원회_기업 재무정보」 활용신청 필요.',
    'stdio',
    'uvx --with mcp<2 data-go-mcp.fsc-financial-info==0.2.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["API_KEY"], "properties": {"API_KEY": {"type": "string", "title": "공공데이터포털 인증키 (Decoding)", "secret": true, "description": "data.go.kr 마이페이지 「인증키 발급현황」의 일반 인증키(Decoding). 이 키로 「금융위원회_기업 재무정보」 API 를 활용신청해야 동작"}}}'::jsonb,
    TRUE
),
(
    'mcp-datago-nts',
    '공공데이터 · 국세청 사업자등록 진위확인',
    '사업자등록번호 진위확인·상태(계속/휴업/폐업) 조회·일괄 확인(validate_business/check_business_status/batch_validate_businesses). data.go.kr 인증키 + 「국세청_사업자등록정보 진위확인 및 상태조회」 활용신청 필요.',
    'stdio',
    'uvx --with mcp<2 data-go-mcp.nts-business-verification==0.2.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["API_KEY"], "properties": {"API_KEY": {"type": "string", "title": "공공데이터포털 인증키 (Decoding)", "secret": true, "description": "data.go.kr 일반 인증키(Decoding). 「국세청_사업자등록정보 진위확인 및 상태조회 서비스」 활용신청 필요"}}}'::jsonb,
    TRUE
),
(
    'mcp-datago-pps',
    '공공데이터 · 조달청 나라장터 입찰·낙찰·계약',
    '나라장터 입찰공고·낙찰정보·계약정보 검색과 입찰공고 상세(search_bid_announcements/search_successful_bids/search_contracts/get_bid_detail). data.go.kr 인증키 + 「조달청_나라장터 공공데이터개방표준서비스」 활용신청 필요.',
    'stdio',
    'uvx --with mcp<2 data-go-mcp.pps-narajangteo==0.1.1',
    '{}'::jsonb,
    '{"type": "object", "required": ["API_KEY"], "properties": {"API_KEY": {"type": "string", "title": "공공데이터포털 인증키 (Decoding)", "secret": true, "description": "data.go.kr 일반 인증키(Decoding). 「조달청_나라장터 공공데이터개방표준서비스」 활용신청 필요"}}}'::jsonb,
    TRUE
),
(
    'mcp-datago-nps',
    '공공데이터 · 국민연금 가입 사업장',
    '국민연금 가입 사업장 검색·상세·기간별 가입자 현황(search_business/get_business_detail/get_period_status) — 회사 규모·고용 추이 확인. data.go.kr 인증키 + 「국민연금공단_국민연금 가입 사업장 내역」 활용신청 필요.',
    'stdio',
    'uvx --with mcp<2 data-go-mcp.nps-business-enrollment==0.2.0',
    '{}'::jsonb,
    '{"type": "object", "required": ["API_KEY"], "properties": {"API_KEY": {"type": "string", "title": "공공데이터포털 인증키 (Decoding)", "secret": true, "description": "data.go.kr 일반 인증키(Decoding). 「국민연금공단_국민연금 가입 사업장 내역」 활용신청 필요"}}}'::jsonb,
    TRUE
)
ON CONFLICT (id) DO NOTHING;
