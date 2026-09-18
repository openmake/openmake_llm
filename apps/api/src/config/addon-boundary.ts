/**
 * Base ↔ Add-on 경계 분류표 (Add-on 전환 P0, 2026-09-18).
 *
 * Base = mechanism(런타임), Add-on = capability(콘텐츠·기능). 폴더를 옮기지 않고 의존 방향부터 고정한다.
 * 여기 적힌 "콘텐츠 자산"은 앞으로 `addons/builtin/*` 번들로 나갈 대상이고, Base 코드가 그것을 직접
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
    /category-guidelines\.json/,
    /category-knowledge\.json/,
    /agent-professional-notes\.json/,
    /utility-skills-[ab]\.json/,
    /\/skill-seeder'/,
    /\/utility-skills-seeder'/,
    /\/utility-skills-data-[ab]'/,
    /\/skill-guidelines'/,
];

/**
 * 콘텐츠 자산을 직접 참조해도 되는 파일(`apps/api/src` 기준) — 2026-09-18 현황 동결.
 * 목표 상태는 `addon-host/` 의 내장 번들 로더 한 곳이다. 항목을 지우는 것은 언제나 환영, 추가는 금지.
 */
export const CONTENT_REFERENCE_ALLOWLIST: readonly string[] = [
    'addon-host/index.ts',            // 내장 콘텐츠 시드의 유일한 부팅 진입점
    'agents/enhanced-keywords.ts',    // skill-seeder 의 RICH_SKILL_CONTENT — P2 에서 번들 로드 결과로 대체
    'agents/skill-guidelines.ts',     // 카테고리 지침 JSON 로더 — P2 에서 번들로 이동
    'agents/skill-seeder.ts',         // P2 에서 번들 설치기로 대체
    'agents/system-skill-names.ts',   // 시스템 스킬 영문명 — P2
    'agents/types.ts',                // industry-agents.json 로더 — P2
    'agents/utility-skills-data-a.ts',
    'agents/utility-skills-data-b.ts',
    'agents/utility-skills-seeder.ts',
];
