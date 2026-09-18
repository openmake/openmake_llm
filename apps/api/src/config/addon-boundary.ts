/**
 * Base ↔ Add-on 경계 분류표 (Add-on 전환 P0, 2026-09-18).
 *
 * Base = mechanism(런타임), Add-on = capability(콘텐츠·기능). 폴더를 옮기지 않고 의존 방향부터 고정한다.
 * 여기 적힌 "콘텐츠 자산"은 `apps/api/addons/builtin/*` 팩의 파일과 그것을 읽는 로더·시더이고, Base 코드가 그것을 직접
 * 참조하는 지점은 `CONTENT_REFERENCE_ALLOWLIST` 로 동결한다 — **목록은 줄어들기만 한다**(래칫).
 * 새 참조가 필요해 보이면 Base 에 콘텐츠를 더 묶는 대신 Add-on Host 경유를 검토할 것.
 * 판정은 `config/__tests__/addon-boundary.test.ts` 가 고정한다.
 *
 * MCP·Skill **런타임**(tool router·external-client·skill-manager·manifest-injection)은 Base 다 —
 * 채팅·에이전트 작업 루프의 일부라 여기 대상이 아니다.
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
    'agents/enhanced-keywords.ts',    // 산업 팩 라우팅 어휘
    'agents/system-skill-names.ts',   // 팩 스킬 영어 표시 이름
    'agents/types.ts',                // 산업 에이전트 정의 로더
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

/** 웹(`apps/web` 기준)의 계약 예외 — 서버 API 응답 필드 이름을 그대로 읽는 화면 */
export const WEB_ADDON_NAME_CONTRACT_EXCEPTIONS: Readonly<Record<string, string>> = {
    'app/(workspace)/admin/metrics/page.tsx': '관리자 지표 API 응답 필드 discussionIntentTurns (routes/metrics.routes.ts)',
};
