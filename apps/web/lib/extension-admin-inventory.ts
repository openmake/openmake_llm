/**
 * 관리자 확장 현황(M3) — API 타입·노출 여부 훅·순수 도우미.
 *
 * 노출은 서버 플래그 `EXTENSION_ADMIN_INVENTORY_ENABLED`(기본 OFF) — `GET /api/admin/extensions/status` 가 켜졌다고 답할 때만
 * 관리자 탭을 보인다(로딩 중·실패·꺼짐 → 숨김).
 */
import { useQuery } from "@tanstack/react-query";
import { ApiClient } from "@/lib/api-client";

export interface InventoryComponent { id: string; name: string; status: string; enabled?: boolean }
export interface InventoryNegotiation {
  authMethod: string;
  protocolEra: string | null;
  protocolVersion: string | null;
  sdkGeneration: string;
  observedAt: string;
}
export interface InventoryMcpComponent extends InventoryComponent { transport?: string; negotiation?: InventoryNegotiation | null }

export interface InventoryItem {
  id: string;
  name: string;
  version: string;
  status: string;
  /** org: 조직 소유 설치(212) — EXTENSION_ORG_OWNED_INSTALL_ENABLED 가 켜져 있을 때만 온다(username = 조직 이름) */
  owner: { id: string; username: string | null; email: string | null; org?: { id: string; name: string | null } };
  source: { url: string; ref: string; trackingRef: string | null; path: string; commit: string };
  visibility: string;
  orgId: string | null;
  permissionState: string;
  installState: string | null;
  components: { skills: InventoryComponent[]; mcpServers: InventoryMcpComponent[]; agents: InventoryComponent[] };
  approval: { draft: number; active: number; archived: number; other: number };
  componentsUnavailable?: true;
  createdAt: string;
  updatedAt: string;
}

export interface InventorySource { sourceUrl: string; installs: number; users: number; lastInstalledAt: string }
export interface InventoryPage { items: InventoryItem[]; nextCursor: string | null; sources: InventorySource[] }

export interface PolicyPreviewBlocked {
  extensionId: string;
  name: string;
  owner: { id: string; username: string | null; org?: { id: string; name: string | null } };
  source: { url: string; trackingRef: string | null };
  verdict: { reason: string; scope?: "global" | "organization"; rule?: unknown; source: string };
}
export interface PolicyPreviewMcpBlocked {
  extensionId: string;
  name: string;
  owner: { id: string; username: string | null; org?: { id: string; name: string | null } };
  server: { id: string; name: string; transport: string };
  verdict: { reason: string; scope?: "global" | "organization"; rule?: unknown; server: string };
}
export interface PolicyPreview {
  enforced: boolean;
  arbitraryUrlInstall: string;
  checked: number;
  blocked: PolicyPreviewBlocked[];
  truncated: boolean;
  /** 확장 MCP 서버 정책(§8-3) 미리보기 — 구 서버 응답에는 없다 */
  mcpServers?: { enforced: boolean; checked: number; blocked: PolicyPreviewMcpBlocked[]; unavailable?: true };
}

export interface InventoryFilter { q: string; userId: string; source: string; status: "" | "active" | "removed" }

export const EXTENSION_INVENTORY_PAGE_SIZE = 50;

/** 필터 + 커서 → 쿼리 문자열(빈 값은 보내지 않는다) */
export function inventoryQueryString(f: InventoryFilter, cursor: string | null, limit = EXTENSION_INVENTORY_PAGE_SIZE): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.userId.trim()) p.set("userId", f.userId.trim());
  if (f.source.trim()) p.set("source", f.source.trim());
  if (f.status) p.set("status", f.status);
  if (cursor) p.set("cursor", cursor);
  p.set("limit", String(limit));
  return p.toString();
}

/** 커밋 표시 — 40자 sha 는 앞 12자 */
export function shortCommit(commit: string): string {
  return /^[0-9a-f]{40}$/i.test(commit) ? commit.slice(0, 12) : commit;
}

/** 확장의 MCP 서버 중 협상 관측이 있는 것만 "전송 · 인증 · 리비전" 한 줄로 */
export function negotiationSummary(servers: InventoryMcpComponent[]): string[] {
  return servers.map((s) => {
    const n = s.negotiation;
    const parts = [s.transport ?? "?", n?.authMethod, n?.protocolVersion ?? n?.protocolEra].filter(Boolean);
    return `${s.name}: ${parts.join(" · ")}`;
  });
}

/** 노출 여부 — 서버가 켜졌다고 확인했을 때만 true(fail-closed) */
export function useExtensionAdminInventoryEnabled(active: boolean): boolean {
  const { data } = useQuery({
    queryKey: ["admin-extensions-status"],
    queryFn: () => ApiClient.get<{ data: { enabled: boolean } }>("/api/admin/extensions/status"),
    enabled: active,
    staleTime: 60_000,
    retry: false,
  });
  return active && data?.data?.enabled === true;
}
