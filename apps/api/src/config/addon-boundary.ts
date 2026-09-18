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
];

/** add-on 고유 이름이 나와도 되는 위치(`apps/api/src` 기준 접두) — add-on 모듈과 그것을 모으는 호스트뿐 */
export const ADDON_NAME_ALLOWED_PREFIXES: readonly string[] = ['addons/', 'addon-host/'];
