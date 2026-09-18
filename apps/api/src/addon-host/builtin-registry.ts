/**
 * 내장 Add-on 레지스트리 — 어떤 기본 제공 팩을 켤지 (Add-on 전환 P1, 2026-09-18).
 *
 * 팩 구성은 배포마다 다른 값이라 env(`ADDON_BUILTIN_DISABLED`, 쉼표 구분 id)로 받는다. 산업 에이전트
 * 데이터는 모듈 로드 시점에 읽히므로 DB overlay(system_settings)보다 앞선다 — 변경은 재시작으로 반영.
 * 이 모듈은 다른 앱 모듈을 import 하지 않는다(콘텐츠 로더가 순환 없이 부를 수 있어야 한다).
 *
 * 팩 콘텐츠 원본은 `apps/api/addons/builtin/<id>/` 이고, 빌드(`copy-addons`)가 `dist/addons/` 로 스냅샷을 뜬다.
 * 빌드본은 **스냅샷만** 읽는다 — 운영 프로세스가 작업 트리를 직접 읽으면 브랜치 전환·편집이 재시작 시점에
 * 운영 콘텐츠를 바꾼다(2026-09-19, 작업 브랜치가 지운 파일을 운영 빌드가 찾지 못할 뻔했다). 스냅샷이 없으면
 * 로더가 throw 해 부팅에서 드러난다(조용한 폴백 없음). 콘텐츠 경로는 `builtinAddonDir` 로만 풀 것.
 *
 * @module addon-host/builtin-registry
 */
import * as path from 'path';

export const BUILTIN_ADDON_IDS = ['industry-pack', 'utility-pack', 'connectors-pack', 'notebooklm', 'kakao-map', 'discord'] as const;
export type BuiltinAddonId = typeof BUILTIN_ADDON_IDS[number];

/**
 * content = 스킬·에이전트 정의를 싣는 팩(설치·보관 대상), integration = 코드가 레포에 있는 통합 기능
 * (꺼지면 전용 라우트를 마운트하지 않는다 — addon-host/routes.ts). 통합 기능이 쓰는 외부 MCP 서버는
 * 이 축과 별개로 사용자가 카탈로그에서 설치한다.
 */
export const BUILTIN_ADDON_KIND: Readonly<Record<BuiltinAddonId, 'content' | 'integration'>> = {
    'industry-pack': 'content',
    'utility-pack': 'content',
    'connectors-pack': 'content',
    'notebooklm': 'integration',
    'kakao-map': 'integration',
    'discord': 'integration',
};

/**
 * 팩이 소유한 시스템 스킬의 `source_path` LIKE 패턴 — 팩을 끄면 여기 걸리는 시스템 스킬을 보관(archived)해
 * 주입을 멈춘다. 팩 `skills.json` 의 `sourcePath` 와 짝이다(산업 `agents/prompts/<산업>/<agent>.md`,
 * 유틸리티 `agents/utility-skills/...`) — `pack-skills.test.ts` 가 모든 팩 스킬이 자기 패턴에 걸리는지 확인한다.
 * ⚠️ id 접두사(`system-skill-`)로 고르지 말 것 — Base 스킬(general·author-guide)과 수동 등록 시스템 스킬
 * (`system-skill-karpathy-guidelines`)이 같은 접두사를 쓴다.
 */
export const BUILTIN_ADDON_SKILL_SOURCE_PATH: Readonly<Partial<Record<BuiltinAddonId, string>>> = {
    'industry-pack': 'agents/prompts/%/%',
    'utility-pack': 'agents/utility-skills/%',
};

/** 이 모듈이 빌드 산출물(`<outDir>/addon-host`)에서 실행 중인가 — src(ts-node·jest)면 false. */
const RUNNING_FROM_BUILD = path.basename(path.resolve(__dirname, '..')) !== 'src';

/** 팩 콘텐츠 디렉토리 — 빌드본은 `<outDir>/addons/builtin/<id>` 스냅샷, src 실행은 `apps/api/addons/builtin/<id>` 원본. */
export function builtinAddonDir(id: BuiltinAddonId): string {
    return RUNNING_FROM_BUILD
        ? path.resolve(__dirname, '..', 'addons', 'builtin', id)
        : path.resolve(__dirname, '..', '..', 'addons', 'builtin', id);
}

function disabledIds(): Set<string> {
    return new Set((process.env.ADDON_BUILTIN_DISABLED ?? '').split(',').map(s => s.trim()).filter(Boolean));
}

export function isBuiltinAddonEnabled(id: BuiltinAddonId): boolean {
    return !disabledIds().has(id);
}

/** 설정에 적혔지만 레지스트리에 없는 id — 오타로 팩이 조용히 켜진 채 남는 것을 부팅 로그로 알린다. */
export function unknownDisabledIds(): string[] {
    const known: readonly string[] = BUILTIN_ADDON_IDS;
    return [...disabledIds()].filter(id => !known.includes(id));
}
