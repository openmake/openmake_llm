/**
 * Add-on 권한 어휘 — 매니페스트 `permissions` 에 적을 수 있는 값과 그것이 **실제로 여는 것** (2026-09-20).
 *
 * 원칙: **집행 지점이 있는 권한만 어휘에 둔다.** 선언만 있고 아무것도 막지 않는 권한은 거짓 안심을 준다
 * (계획서 예시의 `files:read` 는 집행 지점이 없어 넣지 않았다). 새 권한은 집행 코드와 함께 추가할 것.
 *
 * 선언하지 않으면 닫힌다(deny by default) — 단, `openmake-addon.json` 을 **동봉한 번들에만** 적용된다.
 * 매니페스트 없는 종전 확장(plugin.json 만)은 기존 동작 그대로다(하위호환).
 *
 * @module config/addon-permissions
 */
export const ADDON_PERMISSIONS = {
    /**
     * 네트워크 사용. 집행: 설치형 번들의 stdio MCP 서버는 이 권한이 없으면 docker 샌드박스
     * `--network none` 으로 저장되고, 원격(HTTP) MCP 서버는 설치에서 제외된다
     * (`agents/git-ingest/extension-components.ts` collectMcpDrafts).
     */
    NETWORK_INTERNET: 'network:internet',
    /**
     * add-on 전용 스키마. 집행: 이 권한이 없으면 `components.migrations` 를 선언해도 적용하지 않는다
     * (`addon-host/index.ts` applyEnabledAddonMigrations).
     */
    DATABASE_ADDON: 'database:addon',
} as const;

export type AddonPermission = typeof ADDON_PERMISSIONS[keyof typeof ADDON_PERMISSIONS];

export const ADDON_PERMISSION_VALUES = Object.values(ADDON_PERMISSIONS) as [AddonPermission, ...AddonPermission[]];

/** 관리자 화면·설치 리포트용 설명 */
export const ADDON_PERMISSION_LABELS: Readonly<Record<AddonPermission, string>> = {
    'network:internet': '네트워크 사용 (MCP 서버의 외부 통신)',
    'database:addon': 'add-on 전용 DB 스키마 적용',
};

export function hasAddonPermission(permissions: readonly string[] | undefined, perm: AddonPermission): boolean {
    return !!permissions?.includes(perm);
}

/**
 * 설치형 확장(user_extensions)의 권한 상태 (마이그레이션 190, 2026-10-16 — 설계 D4).
 *   reviewed          — 승인 기록(permissions_granted) 안에서 집행한다
 *   legacy_unreviewed — 매니페스트·승인 기록이 없는 예전 설치. 종전 동작(네트워크 허용)을 보존한다
 *   review_required   — 업데이트가 승인 범위보다 넓은 권한을 요구했다. 초과분만 막는다
 */
export const EXTENSION_PERMISSION_STATES = ['reviewed', 'legacy_unreviewed', 'review_required'] as const;
export type ExtensionPermissionState = typeof EXTENSION_PERMISSION_STATES[number];

/**
 * 매니페스트 없는 확장이 종전에 실제로 쓰던 권한 — 레거시 설치를 재승인하거나, 매니페스트가 사라진 업데이트를
 * 판정할 때 "요청 권한"으로 본다. 레거시 확장은 MCP 서버의 외부 통신만 열려 있었다(DB 스키마는 내장 add-on 전용).
 */
export const LEGACY_IMPLICIT_PERMISSIONS: readonly AddonPermission[] = [ADDON_PERMISSIONS.NETWORK_INTERNET];

/** 어휘에 있는 권한 문자열인가 — DB·매니페스트에서 읽은 값을 거를 때 쓴다 */
export function isAddonPermission(value: string): value is AddonPermission {
    return (ADDON_PERMISSION_VALUES as readonly string[]).includes(value);
}
