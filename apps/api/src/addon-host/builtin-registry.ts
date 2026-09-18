/**
 * 내장 Add-on 레지스트리 — 어떤 기본 제공 팩을 켤지 (Add-on 전환 P1, 2026-09-18).
 *
 * 팩 구성은 배포마다 다른 값이라 env(`ADDON_BUILTIN_DISABLED`, 쉼표 구분 id)로 받는다. 산업 에이전트
 * 데이터는 모듈 로드 시점에 읽히므로 DB overlay(system_settings)보다 앞선다 — 변경은 재시작으로 반영.
 * 이 모듈은 다른 앱 모듈을 import 하지 않는다(콘텐츠 로더가 순환 없이 부를 수 있어야 한다).
 *
 * 팩 콘텐츠는 `apps/api/addons/builtin/<id>/` 에 있다 — src 밖이라 tsc 산출물에 의존하지 않고, src·dist
 * 어느 쪽에서 실행해도 같은 경로로 풀린다(`builtinAddonDir`). 콘텐츠 경로를 직접 조립하지 말 것.
 *
 * @module addon-host/builtin-registry
 */
import * as path from 'path';

export const BUILTIN_ADDON_IDS = ['industry-pack', 'utility-pack'] as const;
export type BuiltinAddonId = typeof BUILTIN_ADDON_IDS[number];

/**
 * 팩이 소유한 시스템 스킬의 `source_path` LIKE 패턴 — 팩을 끄면 여기 걸리는 시스템 스킬을 보관(archived)해
 * 주입을 멈춘다. 시더가 적는 source_path 와 짝이다(skill-seeder `agents/prompts/<산업>/<agent>.md`,
 * utility-skills-seeder `agents/utility-skills/...`).
 * ⚠️ id 접두사(`system-skill-`)로 고르지 말 것 — Base 스킬(general·author-guide)과 수동 등록 시스템 스킬
 * (`system-skill-karpathy-guidelines`)이 같은 접두사를 쓴다.
 */
export const BUILTIN_ADDON_SKILL_SOURCE_PATH: Readonly<Record<BuiltinAddonId, string>> = {
    'industry-pack': 'agents/prompts/%/%',
    'utility-pack': 'agents/utility-skills/%',
};

/** 팩 콘텐츠 디렉토리 — `apps/api/{src|dist}/addon-host` 기준 두 단계 위의 `addons/builtin/<id>`. */
export function builtinAddonDir(id: BuiltinAddonId): string {
    return path.resolve(__dirname, '..', '..', 'addons', 'builtin', id);
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
