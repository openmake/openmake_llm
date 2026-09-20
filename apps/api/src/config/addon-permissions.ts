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
