/**
 * 설치형 확장의 권한 상태 판정 — 순수 함수 (2026-10-16, 로드맵 작업 8 · 설계 D4).
 *
 * 저장 상태(user_extensions.permission_state·permissions_granted)와 이번 번들의 요청 권한
 * (openmake-addon.json permissions, 동봉하지 않았으면 null)을 받아 다음 상태·막을 권한·설치 집행에 넘길 허용 권한을 정한다.
 *   ① 첫 설치 — 매니페스트가 없으면 legacy_unreviewed(집행 없음, 종전 동작). 있으면 설치자가 그 권한을 승인한 것으로 reviewed
 *      (종전에도 동봉 번들은 자기 매니페스트 권한으로 deny-by-default 집행을 받았다 — 결과는 같고 기록만 생긴다)
 *   ② legacy_unreviewed — 매니페스트가 계속 없으면 그대로. 새로 생기면 레거시가 쓰던 권한(LEGACY_IMPLICIT_PERMISSIONS)과
 *      대조해 그 안이면 reviewed, 넘으면 review_required(넘는 것만 막는다)
 *   ③ reviewed·review_required — 요청이 승인 범위를 넘으면 review_required(넘는 것만 막고 기존 승인 범위 유지),
 *      넘지 않으면 reviewed(승인 기록은 그대로). 매니페스트가 사라진 업데이트는 레거시 묵시 권한을 요청한 것으로 본다 —
 *      매니페스트를 빼서 집행을 피할 수 없다.
 * DB·네트워크를 부르지 않는다. 저장은 UserExtensionPermissionRepository, 집행은 agents/git-ingest/extension-components.
 *
 * @module services/extensions/permission-state
 */
import {
    ADDON_PERMISSIONS,
    LEGACY_IMPLICIT_PERMISSIONS,
    isAddonPermission,
    type AddonPermission,
    type ExtensionPermissionState,
} from '../../config/addon-permissions';

export interface PermissionStateInput {
    /** 저장된 상태. null = 첫 설치(행이 아직 없다) */
    state: ExtensionPermissionState | null;
    /** 저장된 승인 권한. null = 승인 기록 없음 */
    granted: readonly string[] | null;
    /** 이번 번들의 요청 권한. null = openmake-addon.json 미동봉 */
    requested: readonly string[] | null;
}

export interface PermissionEvaluation {
    next: ExtensionPermissionState;
    /** 요청했지만 승인 범위 밖이라 막는 권한 */
    blocked: AddonPermission[];
    /** 저장할 승인 권한. legacy_unreviewed 면 null */
    granted: AddonPermission[] | null;
    /** 저장할 요청 권한(어휘 안·중복 제거·정렬). 매니페스트 미동봉이면 null */
    requested: AddonPermission[] | null;
    /** 설치 집행에 넘길 허용 권한(ComponentContext.addonPermissions). undefined = 집행 없음(레거시 동작) */
    effective: AddonPermission[] | undefined;
    /** 이번 판정이 새 승인 기록(permissions_reviewed_by·at)을 남기는가 */
    reviewedNow: boolean;
}

/** 조회 응답 모양 — 화면(apps/web/lib/extension-permission-state.ts)이 그대로 받는다 */
export interface PermissionView {
    state: ExtensionPermissionState;
    granted: AddonPermission[] | null;
    requested: AddonPermission[] | null;
    blocked: AddonPermission[];
    reviewedAt: string | null;
}

/** 어휘 안 값만 남기고 중복 제거·정렬. null·undefined 는 null(= 매니페스트 없음·승인 기록 없음) */
export function normalizePermissions(values: readonly unknown[] | null | undefined): AddonPermission[] | null {
    if (values === null || values === undefined) return null;
    const known = values.filter((v): v is AddonPermission => typeof v === 'string' && isAddonPermission(v));
    return [...new Set(known)].sort();
}

/** 판정에 쓰는 요청 권한 — 매니페스트가 없으면 레거시 묵시 권한 */
export function effectiveRequested(requested: readonly unknown[] | null | undefined): AddonPermission[] {
    return normalizePermissions(requested) ?? [...LEGACY_IMPLICIT_PERMISSIONS].sort();
}

function without(list: readonly AddonPermission[], remove: readonly AddonPermission[]): AddonPermission[] {
    return list.filter((p) => !remove.includes(p));
}

export function evaluatePermissionState(input: PermissionStateInput): PermissionEvaluation {
    const requested = normalizePermissions(input.requested);

    // ① 첫 설치
    if (input.state === null) {
        return requested === null
            ? { next: 'legacy_unreviewed', blocked: [], granted: null, requested, effective: undefined, reviewedNow: false }
            : { next: 'reviewed', blocked: [], granted: requested, requested, effective: requested, reviewedNow: true };
    }

    // ② 레거시
    if (input.state === 'legacy_unreviewed') {
        if (requested === null) {
            return { next: 'legacy_unreviewed', blocked: [], granted: null, requested, effective: undefined, reviewedNow: false };
        }
        const blocked = without(requested, LEGACY_IMPLICIT_PERMISSIONS);
        const granted = without(requested, blocked);
        return blocked.length === 0
            ? { next: 'reviewed', blocked, granted, requested, effective: granted, reviewedNow: true }
            : { next: 'review_required', blocked, granted, requested, effective: granted, reviewedNow: false };
    }

    // ③ reviewed · review_required
    const granted = normalizePermissions(input.granted) ?? [];
    const want = effectiveRequested(requested);
    const blocked = without(want, granted);
    return {
        next: blocked.length === 0 ? 'reviewed' : 'review_required',
        blocked,
        granted,
        requested,
        effective: without(want, blocked),
        reviewedNow: false,
    };
}

/** 재승인 — 요청 권한 전부를 승인한다(매니페스트가 없으면 레거시 묵시 권한) */
export function approvePermissions(input: { requested: readonly string[] | null }): PermissionEvaluation {
    const requested = normalizePermissions(input.requested);
    const granted = effectiveRequested(requested);
    return { next: 'reviewed', blocked: [], granted, requested, effective: granted, reviewedNow: true };
}

/** 철회 — 승인 범위에서 `remove` 를 뺀 뒤 ③ 규칙으로 다시 판정한다(레거시는 묵시 권한에서 뺀다) */
export function revokePermissions(input: PermissionStateInput, remove: readonly string[]): PermissionEvaluation {
    const base = input.state === 'legacy_unreviewed' || input.state === null
        ? effectiveRequested(null)
        : normalizePermissions(input.granted) ?? [];
    const granted = without(base, normalizePermissions(remove) ?? []);
    return { ...evaluatePermissionState({ state: 'reviewed', granted, requested: input.requested }), reviewedNow: true };
}

/** 네트워크가 열려 있는가 — effective 가 undefined(레거시)면 종전대로 열려 있다 */
export function allowsNetwork(evaluation: Pick<PermissionEvaluation, 'effective'>): boolean {
    return evaluation.effective === undefined || evaluation.effective.includes(ADDON_PERMISSIONS.NETWORK_INTERNET);
}

/** 저장 행 → 조회 응답. blocked 는 저장된 요청·승인으로 다시 계산한다 */
export function describePermissions(row: {
    permission_state: ExtensionPermissionState;
    permissions_granted: readonly string[] | null;
    permissions_requested: readonly string[] | null;
    permissions_reviewed_at: Date | string | null;
}): PermissionView {
    const current = evaluatePermissionState({
        state: row.permission_state,
        granted: row.permissions_granted,
        requested: row.permissions_requested,
    });
    return {
        state: row.permission_state,
        granted: normalizePermissions(row.permissions_granted),
        requested: normalizePermissions(row.permissions_requested),
        blocked: current.blocked,
        reviewedAt: toIsoOrNull(row.permissions_reviewed_at),
    };
}

/** 저장 시각 → ISO 문자열. 날짜로 읽히지 않는 값은 null — 조회 전체가 RangeError 로 실패하지 않게 한다 */
function toIsoOrNull(value: Date | string | null): string | null {
    if (value === null) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** 권한 오류 코드 — extension-components 가 MCP 결과 error 앞에 붙인다 */
const PERMISSION_ERROR_PATTERN = /^PERMISSION_(DENIED|REVIEW_REQUIRED)\b/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

/**
 * 설치 기록(manifest.components.mcpServers)에서 권한 때문에 설치에서 빠진 MCP 서버 이름.
 * 저장 JSON 이 어긋나도(배열 아님·null 요소·이름 없음) 던지지 않고 건너뛴다.
 */
export function permissionExcludedServers(manifest: Record<string, unknown> | null | undefined): string[] {
    const components = manifest?.components;
    const servers = isRecord(components) ? components.mcpServers : undefined;
    if (!Array.isArray(servers)) return [];
    return servers
        .filter(isRecord)
        .filter((s) => typeof s.name === 'string' && typeof s.error === 'string' && PERMISSION_ERROR_PATTERN.test(s.error))
        .map((s) => s.name as string);
}
