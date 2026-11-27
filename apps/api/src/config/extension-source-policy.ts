/**
 * @module config/extension-source-policy
 * @description 확장 원본 정책(마켓플레이스 남은 개발계획 v3.7 M2) — 플래그·규칙 스키마.
 *
 * 전부 opt-in(기본 OFF = 종전 동작). 운영 기능 프로필(`scripts/setup/profiles/ops-features.env`)이 켠다.
 * 값은 호출 시점에 `getConfig()`(system_settings overlay > env > 기본값)로 읽는다 — 관리자 설정 변경이 재시작 없이 닿는다.
 *
 * - `EXTENSION_SOURCE_POLICY_ENFORCED`  마스터 스위치. OFF 면 정책이 저장돼 있어도 검사하지 않는다.
 *                                       ON + 정책 조회 실패 = 마지막으로 적용한 정책 유지(없으면 거절).
 * - `EXTENSION_ARBITRARY_URL_INSTALL`   `allow`(기본, 종전) · `catalog-only`(등록된 카탈로그 원본만). ENFORCED 일 때만 의미.
 * - `EXTENSION_SOURCE_POLICY`           전역 원본 규칙 `{ allow?: Rule[], deny?: Rule[] }`(JSON). 조직 정책 같은 키와 층으로 겹친다.
 *
 * 규칙 형태·매칭은 services/extensions/source-policy.ts 머리말.
 */
import { z } from 'zod';
import { getConfig } from './env';

export const EXTENSION_SOURCE_POLICY_KEYS = {
    ENFORCED: 'EXTENSION_SOURCE_POLICY_ENFORCED',
    ARBITRARY_URL_INSTALL: 'EXTENSION_ARBITRARY_URL_INSTALL',
    POLICY: 'EXTENSION_SOURCE_POLICY',
} as const;

/** 거절 오류 코드 — HTTP 403. add-on 라우트가 메시지 접두어로 알아본다(runtime-ports/extension-source-policy 재노출) */
export const EXTENSION_SOURCE_BLOCKED_CODE = 'EXTENSION_SOURCE_BLOCKED';

export const ARBITRARY_URL_INSTALL_MODES = ['allow', 'catalog-only'] as const;
export type ArbitraryUrlInstallMode = typeof ARBITRARY_URL_INSTALL_MODES[number];

/** 규칙 하나·목록 길이 상한 (명명 상수 — 저장 검증과 읽기 검증이 같은 값을 쓴다) */
export const EXTENSION_SOURCE_POLICY_LIMITS = {
    MAX_RULES: 200,
    MAX_FIELD_CHARS: 500,
} as const;

const field = z.string().trim().min(1).max(EXTENSION_SOURCE_POLICY_LIMITS.MAX_FIELD_CHARS);
/** owner/repo 또는 owner/* */
const repoField = field.regex(/^[A-Za-z0-9_.-]+\/(\*|[A-Za-z0-9_.-]+)$/, 'owner/repo 또는 owner/* 형식이어야 합니다');
/** 정규식 — 컴파일되지 않으면 스키마 실패(= 정책 전체를 깨진 값으로 취급) */
const regexField = field.refine((v) => { try { new RegExp(v); return true; } catch { return false; } }, '정규식이 올바르지 않습니다');

export const EXTENSION_SOURCE_RULE_SCHEMA = z.discriminatedUnion('type', [
    z.object({ type: z.literal('github'), repo: repoField, ref: field.optional(), path: field.optional() }).strict(),
    z.object({ type: z.literal('git'), url: field, ref: field.optional(), path: field.optional() }).strict(),
    z.object({ type: z.literal('archive'), url: field }).strict(),
    z.object({ type: z.literal('hostPattern'), pattern: regexField }).strict(),
    z.object({ type: z.literal('catalog'), id: field }).strict(),
    z.object({ type: z.literal('internal') }).strict(),
    z.object({ type: z.literal('local') }).strict(),
]);
export type ExtensionSourceRule = z.infer<typeof EXTENSION_SOURCE_RULE_SCHEMA>;

const ruleList = z.array(EXTENSION_SOURCE_RULE_SCHEMA).max(EXTENSION_SOURCE_POLICY_LIMITS.MAX_RULES);

export const EXTENSION_SOURCE_POLICY_SCHEMA = z.object({ allow: ruleList.optional(), deny: ruleList.optional() }).strict();

/** 한 층(전역 또는 조직)의 정책. `allow` 미설정 = 제한 없음, `allow: []` = 전부 차단 */
export interface ExtensionSourcePolicyLayer {
    allow?: ExtensionSourceRule[];
    deny: ExtensionSourceRule[];
    /** 층 이름 — 거절 사유에 쓴다 */
    scope: 'global' | 'organization';
    /** 저장 값이 스키마에 맞지 않아 전부 차단으로 바꿨는지 */
    broken?: boolean;
}

/** PURE: 저장 값(파싱된 JSON) → 층. 깨진 값은 `allow: []`(전부 차단) — GitHub 정책 규칙 차용(fail-closed). */
export function parseExtensionSourcePolicy(value: unknown, scope: ExtensionSourcePolicyLayer['scope']): ExtensionSourcePolicyLayer {
    const parsed = EXTENSION_SOURCE_POLICY_SCHEMA.safeParse(value);
    if (!parsed.success) return { allow: [], deny: [], scope, broken: true };
    return { ...(parsed.data.allow !== undefined ? { allow: parsed.data.allow } : {}), deny: parsed.data.deny ?? [], scope };
}

/** 저장 검증 — 비면 저장해도 된다(시스템 설정 registry·조직 정책 저장이 같은 규칙). */
export function extensionSourcePolicyProblems(raw: string): string[] {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return ['JSON 이 아닙니다']; }
    const parsed = EXTENSION_SOURCE_POLICY_SCHEMA.safeParse(value);
    return parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

export const EXTENSION_SOURCE_POLICY_SETTINGS = {
    get enforced(): boolean {
        return getConfig().extensionSourcePolicyEnforced;
    },
    get arbitraryUrlInstall(): ArbitraryUrlInstallMode {
        return getConfig().extensionArbitraryUrlInstall;
    },
    /** 전역 층 — 설정 없음 = undefined(층 없음), JSON 깨짐 = 전부 차단 층 */
    get globalLayer(): ExtensionSourcePolicyLayer | undefined {
        const raw = getConfig().extensionSourcePolicy;
        if (raw.trim() === '') return undefined;
        let value: unknown;
        try { value = JSON.parse(raw); } catch { return { allow: [], deny: [], scope: 'global', broken: true }; }
        return parseExtensionSourcePolicy(value, 'global');
    },
} as const;
