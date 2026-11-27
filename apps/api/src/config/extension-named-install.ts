/**
 * 이름 설치 `플러그인@마켓플레이스` 규칙 (마켓플레이스 남은 개발계획 v3.7 M5 — Claude Code marketplace-reference 와 같은 문자 규칙).
 *
 * - 이름 문자: 영문·숫자·`.`·`_`·`-`, 영문·숫자로 시작, `..` 금지(플러그인·마켓플레이스 공통).
 * - 마켓플레이스 = 등록 카탈로그 원본의 **별칭**(`extension_catalog_sources.alias`, 기본 = 스냅샷 `name`).
 * - 예약 별칭: `internal`·`builtin`·`local` — 내부 게시(`internal://`)·내장·`local://` 과 혼동하지 않게.
 * - 고정 커밋: 항목의 `sha`(40자 소문자 hex)가 있으면 그것, 없으면 `ref`.
 *
 * @module config/extension-named-install
 */

/** 플러그인·마켓플레이스 이름 한 토큰 */
export const NAMED_INSTALL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `플러그인@마켓플레이스` 전체 — 공백·슬래시·콜론이 없어 URL·`git@host:owner/repo` 와 겹치지 않는다 */
export const NAMED_INSTALL_REF_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9._-]*)$/;

/** 마켓플레이스 별칭으로 쓸 수 없는 이름 (소문자 비교) */
export const RESERVED_MARKETPLACE_ALIASES: readonly string[] = ['internal', 'builtin', 'local'];

/** 고정 커밋 sha — 40자 소문자 hex 만 */
export const PINNED_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const NAMED_INSTALL_LIMITS = {
    /** 모르는 이름일 때 안내할 후보 수 */
    MAX_CANDIDATES: 10,
    /** 이름 한 토큰 최대 길이 (marketplace.json name 상한과 같다) */
    NAME_MAX_CHARS: 120,
} as const;

/** PURE: 이름 한 토큰이 규칙에 맞는가 */
export function isValidInstallName(name: string): boolean {
    return name.length <= NAMED_INSTALL_LIMITS.NAME_MAX_CHARS
        && NAMED_INSTALL_NAME_PATTERN.test(name)
        && !name.includes('..');
}

/** PURE: 별칭으로 쓸 수 있는가 — 이름 규칙 + 예약어 아님 */
export function isValidMarketplaceAlias(alias: string): boolean {
    return isValidInstallName(alias) && !RESERVED_MARKETPLACE_ALIASES.includes(alias.toLowerCase());
}

/** PURE: `플러그인@마켓플레이스` 파싱 — 형식이 아니면 null (URL·단축 owner/repo 등은 전부 null) */
export function parseNamedInstallRef(raw: string | undefined | null): { plugin: string; marketplace: string } | null {
    if (!raw) return null;
    const m = NAMED_INSTALL_REF_PATTERN.exec(raw.trim());
    if (!m) return null;
    const [, plugin, marketplace] = m;
    if (!isValidInstallName(plugin) || !isValidInstallName(marketplace)) return null;
    return { plugin, marketplace };
}
