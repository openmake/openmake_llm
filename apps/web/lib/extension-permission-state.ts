/**
 * 설치형 확장의 권한 상태 → 화면 분류 (서버 계약: docs/architecture/addon-platform.md §11, 마이그레이션 190).
 *   reviewed          → "권한 검토됨"   — 재승인 버튼 없음
 *   legacy_unreviewed → "레거시 미검토" — 종전 동작(네트워크 허용) 유지, 재승인으로 지금 권한을 기록할 수 있다
 *   review_required   → "재승인 필요"   — 업데이트가 넓힌 권한만 막혀 있다
 * 서버가 권한 열을 주지 않으면(구 API) unknown — 배지·패널을 그리지 않는다.
 */
export type ExtensionPermissionKind = "reviewed" | "legacy" | "reviewRequired" | "unknown";

export interface ExtensionPermissionFields {
  permission_state?: string | null;
  permissions_granted?: string[] | null;
  permissions_requested?: string[] | null;
}

export interface ExtensionPermissionView {
  kind: ExtensionPermissionKind;
  /** 화면에 보일 요청 권한 — 매니페스트가 없으면 레거시 묵시 권한 */
  requested: string[];
  /** 승인 범위 밖이라 막힌 권한(재승인 필요일 때만) */
  blocked: string[];
  canApprove: boolean;
}

/** 서버 응답 permissions (services/extensions/permission-state PermissionView) */
export interface PermissionViewResponse {
  state: string;
  granted: string[] | null;
  requested: string[] | null;
  blocked: string[];
  reviewedAt: string | null;
}

export interface ApproveResponse {
  permissions: PermissionViewResponse;
  restoredServers: number;
  excludedRemoteServers: string[];
}

export type PermissionMessage =
  | { key: "approved" }
  | { key: "restored"; count: number }
  | { key: "reinstallRemote"; names: string };

/** 매니페스트 없는 확장이 종전에 쓰던 권한 — 서버 config/addon-permissions LEGACY_IMPLICIT_PERMISSIONS 와 같은 값 */
export const LEGACY_IMPLICIT_PERMISSIONS: readonly string[] = ["network:internet"];

/** HTTP 409 — 읽은 뒤 업데이트가 요청 권한을 바꿨다 */
const HTTP_CONFLICT = 409;

const KIND_BY_STATE = new Map<string, ExtensionPermissionKind>([
  ["reviewed", "reviewed"],
  ["legacy_unreviewed", "legacy"],
  ["review_required", "reviewRequired"],
]);

const BADGE_KEYS = new Map<ExtensionPermissionKind, "badge.reviewed" | "badge.legacy" | "badge.reviewRequired">([
  ["reviewed", "badge.reviewed"],
  ["legacy", "badge.legacy"],
  ["reviewRequired", "badge.reviewRequired"],
]);

const IMPACT_KEYS = new Map<ExtensionPermissionKind, "impact.reviewed" | "impact.legacy" | "impact.reviewRequired">([
  ["reviewed", "impact.reviewed"],
  ["legacy", "impact.legacy"],
  ["reviewRequired", "impact.reviewRequired"],
]);

const TONE_CLASSES: Record<ExtensionPermissionKind, string> = {
  reviewed: "text-success",
  legacy: "text-muted",
  reviewRequired: "text-warn",
  unknown: "text-muted",
};

const LABEL_KEYS = new Map<string, "label.network" | "label.database">([
  ["network:internet", "label.network"],
  ["database:addon", "label.database"],
]);

export function extensionPermissionView(ext: ExtensionPermissionFields): ExtensionPermissionView {
  const kind = KIND_BY_STATE.get(ext.permission_state ?? "") ?? "unknown";
  const requested = ext.permissions_requested ?? [...LEGACY_IMPLICIT_PERMISSIONS];
  const granted = ext.permissions_granted ?? [];
  const blocked = kind === "reviewRequired" ? requested.filter((p) => !granted.includes(p)) : [];
  return { kind, requested, blocked, canApprove: kind === "legacy" || kind === "reviewRequired" };
}

export function permissionBadgeKey(kind: ExtensionPermissionKind): "badge.reviewed" | "badge.legacy" | "badge.reviewRequired" | null {
  return BADGE_KEYS.get(kind) ?? null;
}

export function permissionImpactKey(kind: ExtensionPermissionKind): "impact.reviewed" | "impact.legacy" | "impact.reviewRequired" | null {
  return IMPACT_KEYS.get(kind) ?? null;
}

export function permissionToneClass(kind: ExtensionPermissionKind): string {
  return TONE_CLASSES[kind];
}

export function permissionLabelKey(permission: string): "label.network" | "label.database" | null {
  return LABEL_KEYS.get(permission) ?? null;
}

/** 재승인 응답 → 목록 행에 덮어쓸 권한 열 */
export function permissionFieldsFromView(view: PermissionViewResponse): ExtensionPermissionFields {
  return { permission_state: view.state, permissions_granted: view.granted, permissions_requested: view.requested };
}

export function approveOutcomeMessages(res: ApproveResponse): PermissionMessage[] {
  const out: PermissionMessage[] = [{ key: "approved" }];
  if (res.restoredServers > 0) out.push({ key: "restored", count: res.restoredServers });
  if (res.excludedRemoteServers.length > 0) out.push({ key: "reinstallRemote", names: res.excludedRemoteServers.join(", ") });
  return out;
}

export function approveErrorKey(status: number | undefined): "conflict" | "approveFailed" {
  return status === HTTP_CONFLICT ? "conflict" : "approveFailed";
}
