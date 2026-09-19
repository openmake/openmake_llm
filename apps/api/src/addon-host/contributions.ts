/**
 * Add-on 기여 — 켜진 add-on 이 Base 레지스트리(운영 설정·API key 스코프)에 얹는 선언 (2026-09-19).
 *
 * Base 레지스트리는 특정 add-on 의 키·스코프 이름을 적어 두지 않고 여기서 받아 합친다. 기여는 순수 데이터여야
 * 한다 — 설정 레지스트리는 부팅 초기(DB overlay 전)에 읽히므로 기여 모듈이 무거운 의존을 끌어오면 안 된다.
 * 어떤 add-on 이 기여하는지는 매니페스트 `entry.contributions` 가 선언한다.
 * 꺼진 add-on 의 설정 키는 레지스트리에서 빠진다(DB 에 남은 값은 overlay 가 미등록 키로 건너뛴다).
 *
 * @module addon-host/contributions
 */
import { enabledBuiltinAddons } from './builtin-registry';
import { loadAddonEntry } from './entry-loader';

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

/** add-on 이 더하는 CLI 서브커맨드 — 핸들러는 `entry` 참조로 실행 시점에 로드된다(부팅 비용 0) */
export interface AddonCliCommand {
    name: string;
    description: string;
    /** `<모듈>#<export>` — add-on 코드 디렉토리 기준. 시그니처는 `(version: string) => Promise<void>` */
    entry: string;
}

export interface AddonContribution {
    /** CLI 서브커맨드 (`apps/api/src/cli.ts` 가 켜진 add-on 의 것만 등록한다) */
    cliCommands?: readonly AddonCliCommand[];
    /**
     * 첫 실행 셋업 직후 돌릴 훅 — `<모듈>#<export>`, 시그니처는
     * `(envPath: string) => { label: string; applied: boolean; reason: string }`.
     */
    firstRunHooks?: readonly string[];
    /** add-on 이 기여한 도구의 승인 위험 등급 (config/tool-policy.ts 의 등급 이름) */
    toolRisk?: Readonly<Record<string, string>>;
    settings?: readonly AddonSettingDef[];
    apiKeyScopes?: readonly string[];
}

function enabledContributions(): AddonContribution[] {
    return enabledBuiltinAddons()
        .filter(a => a.manifest.entry?.contributions)
        .map(a => loadAddonEntry<AddonContribution>(a, a.manifest.entry!.contributions!));
}

export function contributedSettings(): AddonSettingDef[] {
    return enabledContributions().flatMap(c => [...(c.settings ?? [])]);
}

export function contributedApiKeyScopes(): string[] {
    return enabledContributions().flatMap(c => [...(c.apiKeyScopes ?? [])]);
}

/** 켜진 add-on 이 더한 CLI 서브커맨드 — 핸들러는 호출 시점에 로드한다. */
export function contributedCliCommands(): Array<{ name: string; description: string; run: (version: string) => Promise<void> }> {
    return enabledBuiltinAddons().flatMap(addon => {
        const ref = addon.manifest.entry?.contributions;
        if (!ref) return [];
        const contribution = loadAddonEntry<AddonContribution>(addon, ref);
        return (contribution.cliCommands ?? []).map(cmd => ({
            name: cmd.name,
            description: cmd.description,
            run: (version: string) => loadAddonEntry<(v: string) => Promise<void>>(addon, cmd.entry)(version),
        }));
    });
}

/**
 * 첫 실행 셋업 훅 — 각 훅은 자기 결과를 돌려주고, 실패해도 셋업을 죽이지 않는다(fail-open).
 * Base 는 어떤 add-on 이 무엇을 하는지 모르고 결과 문구만 로그로 남긴다.
 */
export function runFirstRunHooks(envPath: string): Array<{ label: string; applied: boolean; reason: string }> {
    const out: Array<{ label: string; applied: boolean; reason: string }> = [];
    for (const addon of enabledBuiltinAddons()) {
        const ref = addon.manifest.entry?.contributions;
        if (!ref) continue;
        for (const hookRef of loadAddonEntry<AddonContribution>(addon, ref).firstRunHooks ?? []) {
            try {
                out.push(loadAddonEntry<(p: string) => { label: string; applied: boolean; reason: string }>(addon, hookRef)(envPath));
            } catch (err) {
                out.push({ label: `${addon.id}:${hookRef}`, applied: false, reason: err instanceof Error ? err.message : String(err) });
            }
        }
    }
    return out;
}

export function contributedToolRisk(): Record<string, string> {
    return Object.assign({}, ...enabledContributions().map(c => c.toolRisk ?? {}));
}
