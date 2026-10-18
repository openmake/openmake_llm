/**
 * Base ↔ Add-on 경계 분류표 (Add-on 전환 P0, 2026-09-18).
 *
 * Base = mechanism(런타임), Add-on = capability(콘텐츠·기능). 폴더를 옮기지 않고 의존 방향부터 고정한다.
 * 여기 적힌 "콘텐츠 자산"은 `apps/api/addons/builtin/*` 팩의 파일과 그것을 읽는 로더·시더이고, Base 코드가 그것을 직접
 * 참조하는 지점은 `CONTENT_REFERENCE_ALLOWLIST` 로 동결한다 — **목록은 줄어들기만 한다**(래칫).
 * 새 참조가 필요해 보이면 Base 에 콘텐츠를 더 묶는 대신 Add-on Host 경유를 검토할 것.
 * 판정은 `config/__tests__/addon-boundary.test.ts` 가 고정한다.
 *
 * ⚠️ 2026-09-19 (§10 문자 이행): MCP·Skill **런타임도 add-on 으로 나갔다**(`addons/mcp-runtime`·`addons/skill-runtime`).
 * Base 에 남은 것은 **계약과 거버넌스**뿐이다 — 도구 계약·디스패처·실행 가드(`tool-contract/`), 내장 도구(`tools/`),
 * 포트(`runtime-ports/`). Base 코드가 add-on 모듈을 직접 import 하지 못하게 하는 것은 eslint
 * `no-restricted-imports` 의 addons 경로 패턴이고, 아래 목록은 **콘텐츠 자산**(팩 데이터) 참조만 다룬다.
 *
 * @module config/addon-boundary
 */

/** 향후 Add-on 번들로 나갈 콘텐츠 자산 — 소스 안에서 이 문자열로 참조된다(import·readFileSync 공통). */
export const ADDON_CONTENT_ASSET_PATTERNS: readonly RegExp[] = [
    /industry-agents\.json/,
    /routing-vocabulary\.json/,
    /\/pack-skills'/,
];

/**
 * 콘텐츠 자산을 직접 참조해도 되는 파일(`apps/api/src` 기준) — 2026-09-18 현황 동결.
 * 목표 상태는 `addon-host/` 의 내장 번들 로더 한 곳이다. 항목을 지우는 것은 언제나 환영, 추가는 금지.
 */
export const CONTENT_REFERENCE_ALLOWLIST: readonly string[] = [
    'addon-host/authoring/industry-pack-skills.ts',  // 저작 도구 (런타임 아님)
    'addon-host/index.ts',            // 내장 팩 설치의 유일한 부팅 진입점
    'agents/system-skill-names.ts',   // 팩 스킬 영어 표시 이름
];

/**
 * 통합형 add-on 의 고유 이름 — **Base 코드 줄에 나오면 안 된다**(2026-09-19 기준 0건, `addon-boundary.test.ts`).
 * Base 는 일반 확장점(채팅 턴 통합·라우트 마운트·설정/스코프 기여·카탈로그 설치)만 알고, 특정 통합의 도구 이름·
 * 블록 형식·프롬프트 문구·설정 키는 `src/addons/<id>/` 와 그것을 모아 주는 `addon-host/` 에만 둔다.
 * 새 통합을 추가하면 그 고유 이름을 여기에 더한다. 주석은 검사하지 않는다(선례 설명은 자유).
 * 로그인 provider 로서의 'kakao', 알림 채널 등 무관한 쓰임은 아래 패턴에 걸리지 않게 좁혀 두었다.
 */
export const ADDON_SPECIFIC_NAME_PATTERNS: readonly RegExp[] = [
    /kakaomap|kakao[-_]?map|search-places|find-route/i,
    /notebooklm/i,
    /discord/i,
    /discussion/i,
    /deep[-_ ]?research/i,
    // search-providers add-on — 지역·유료 검색 공급원의 이름과 그 설정 키.
    // 결과 URL 의 도메인 표기(`terms.naver.com` 같은 랭킹용 도메인 목록)는 공급원 통합이 아니라 걸리지 않게 좁혔다.
    /naver(?!\.com)|\bdaum(?!\.net)|tavily|searchExa|EXA_API/i,
    // 미디어 runtime add-on(P10) — capability ID(image.generate 등)·MIME·공통 필드의 'image/video' 는 금지 대상이 아니다.
    // 금지 대상은 **개별 구현에 대한 직접 의존**이라 add-on 이름만 막는다(계획서 15.3).
    /image-runtime|music-runtime|video-runtime/i,
    // knowledge-runtime add-on — 일반 단어 'knowledge' 는 막지 않는다(Base 에 knowledge-cutoff 가 있다). 도메인 고유 이름만.
    /knowledge[-_]?runtime|knowledge_space|knowledgeSpace|knowledge_conversation/i,
];

/** add-on 고유 이름이 나와도 되는 위치(`apps/api/src` 기준 접두) — add-on 모듈과 그것을 모으는 호스트뿐 */
export const ADDON_NAME_ALLOWED_PREFIXES: readonly string[] = ['addons/', 'addon-host/'];

/**
 * 위 이름이 나와도 되는 Base 파일(`apps/api/src` 기준)과 그 사유 — **코드로는 바꿀 수 없는 외부 계약**뿐이다.
 * DB 스키마의 컬럼·저장값, 공개 REST 응답 필드가 여기에 해당한다(이름을 바꾸려면 2단계 마이그레이션이나
 * API 버전 변경이 필요하다). 새 항목을 더하려면 같은 수준의 사유가 있어야 한다.
 */
export const ADDON_NAME_CONTRACT_EXCEPTIONS: Readonly<Record<string, string>> = {
    'services/chat-service/orchestration-shadow-recorder.ts': 'DB 컬럼 orchestration_dispatch_log.discussion_intent (086)',
    'data/repositories/routing-metrics-repository.ts': 'DB 컬럼 discussion_intent 집계 SQL (086)',
    'routes/metrics.routes.ts': '관리자 지표 API 응답 필드 discussionIntentTurns (웹 admin 이 읽는다)',
    'chat/verifiability-classifier.ts': "tail 셰도우 테이블의 저장값 would_route_to='deep-research'",
    'chat/profile-resolver.ts': '공개 REST 응답의 실행 계획 필드 useDiscussion (항상 false, 계약 유지)',
    'routes/chat.routes.ts': '공개 REST 응답 필드 discussion (항상 false, 계약 유지)',
    'routes/model.routes.ts': '공개 REST 응답의 모델 capability 필드 discussion (항상 false, 계약 유지)',
    'swagger/schemas-core.ts': '위 REST 응답 필드의 OpenAPI 스키마 (iOS Kit 생성 입력)',
};

/**
 * 코드 밖의 공용 자산(저장소 루트 기준) — 공용 패키지 소스(`packages/*\/src`)와 웹 번역 파일(`apps/web/messages`)에 남은
 * add-on 고유 이름 줄 수 (2026-10-18 범위 확장 시점 동결). 구 클라이언트·iOS WS 계약 필드와 add-on 화면 문구라 당장 옮길 곳이
 * 없어 남겼다 — **줄어들기만 한다**(래칫). 늘리려면 계약 예외와 같은 수준의 사유가 있어야 하고, 줄었으면 여기 값도 낮춘다.
 * 목록에 없는 파일은 0 이어야 한다.
 */
export const SHARED_ASSET_ADDON_NAME_BASELINE: Readonly<Record<string, number>> = {
    'packages/shared-types/src/index.ts': 3,      // WS 채팅 구 필드·진행 이벤트 type(토론·딥리서치)
    'packages/shared-types/src/knowledge.ts': 11, // Knowledge Space API 응답 계약(웹 add-on ↔ API add-on)
    'apps/web/messages/de.json': 25,
    'apps/web/messages/en.json': 26,
    'apps/web/messages/ja.json': 14,
    'apps/web/messages/ko.json': 14,
    'apps/web/messages/zh.json': 14,
};

/**
 * 코어 마이그레이션에 정의돼 있지만 **소유 코드가 add-on 인** 테이블 (2026-10-18 결정 — 종전 "저장은 Base, 판단은 add-on" 을 바꿨다).
 * arch_plan S3 의 "기존 테이블은 코어에 유지" 는 스키마 위치로만 지킨다 — 테이블 정의·마이그레이션 이력은 코어에 그대로 두고,
 * SQL 은 소유 add-on 의 코드만 쓴다. Base 는 포트(`runtime-ports/*`)를 거치고, add-on 이 꺼지면 그 기능을 건너뛴다.
 * 판정: `__tests__/addons-no-base-table-sql.test.ts`(add-on → 남의 테이블), `__tests__/base-no-addon-table-sql.test.ts`(Base → 여기 테이블).
 */
export const ADDON_OWNED_CORE_TABLES: Readonly<Record<string, readonly string[]>> = {
    'mcp-runtime': ['mcp_catalog_oauth_clients', 'mcp_oauth_credentials', 'mcp_server_catalog', 'mcp_server_instances', 'mcp_servers'],
    'skill-runtime': [
        'agent_skill_assignments', 'agent_skills', 'skill_assets', 'skill_audit_log', 'skill_manifests', 'skill_mcp_bundles',
        'skill_permissions', 'skill_tool_bindings',
    ],
};

/** 웹(`apps/web` 기준)의 계약 예외 — 서버 API 응답 필드 이름을 그대로 읽는 화면 */
export const WEB_ADDON_NAME_CONTRACT_EXCEPTIONS: Readonly<Record<string, string>> = {
    'app/(workspace)/admin/metrics/page.tsx': '관리자 지표 API 응답 필드 discussionIntentTurns (routes/metrics.routes.ts)',
};
