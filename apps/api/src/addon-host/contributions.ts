/**
 * Add-on 기여 — 켜진 add-on 이 Base 레지스트리(운영 설정·API key 스코프)에 얹는 선언 (2026-09-19).
 *
 * Base 레지스트리는 특정 add-on 의 키·스코프 이름을 적어 두지 않고 여기서 받아 합친다. 기여는 순수 데이터여야
 * 한다 — 설정 레지스트리는 부팅 초기(DB overlay 전)에 읽히므로 기여 모듈이 무거운 의존을 끌어오면 안 된다.
 * 꺼진 add-on 의 설정 키는 레지스트리에서 빠진다(DB 에 남은 값은 overlay 가 미등록 키로 건너뛴다).
 *
 * @module addon-host/contributions
 */
import { BUILTIN_ADDON_IDS, isBuiltinAddonEnabled, type BuiltinAddonId } from './builtin-registry';

/** 설정 값 검증기 이름 — 실제 zod 스키마는 config/system-settings-registry 가 가진다 */
export type AddonSettingValidator = 'nonEmpty' | 'apiKey' | 'nonNegativeInt' | 'boolean';

export interface AddonSettingDef {
    key: string;
    /** 관리자 화면의 설정 그룹 */
    group: string;
    secret: boolean;
    requiresRestart: boolean;
    validate: AddonSettingValidator;
    issueUrl?: string;
}

export interface AddonContribution {
    /** add-on 이 기여한 도구의 승인 위험 등급 (config/tool-policy.ts 의 등급 이름) */
    toolRisk?: Readonly<Record<string, string>>;
    settings?: readonly AddonSettingDef[];
    apiKeyScopes?: readonly string[];
}

const LOADERS: Readonly<Partial<Record<BuiltinAddonId, () => AddonContribution>>> = {
    'discussion': () => (require('../addons/discussion/contributions') as typeof import('../addons/discussion/contributions')).discussionContribution,
    'discord': () => (require('../addons/discord/contributions') as typeof import('../addons/discord/contributions')).discordContribution,
};

function enabledContributions(): AddonContribution[] {
    return BUILTIN_ADDON_IDS.filter(id => LOADERS[id] && isBuiltinAddonEnabled(id)).map(id => LOADERS[id]!());
}

export function contributedSettings(): AddonSettingDef[] {
    return enabledContributions().flatMap(c => [...(c.settings ?? [])]);
}

export function contributedApiKeyScopes(): string[] {
    return enabledContributions().flatMap(c => [...(c.apiKeyScopes ?? [])]);
}

export function contributedToolRisk(): Record<string, string> {
    return Object.assign({}, ...enabledContributions().map(c => c.toolRisk ?? {}));
}
