/**
 * extension-marketplace add-on (웹) — 확장 갤러리 항목 옆 호환 판정 배지(지원·부분 지원·불가 + 사유·출처)와
 * 관리자 MCP Registry 화면(M7 — 사본·큐레이션·카탈로그로 올리기, 화면은 pages/index.tsx → addons/pages.ts).
 * 서버 매니페스트가 `defaultState: "disabled"` 라 켜짐을 확인하기 전에는 숨긴다 — 꺼져 있으면 갤러리·관리자 탭은 종전 그대로다.
 */
import type { WebAddon } from "../types";
import { VerdictBadge } from "./components/verdict-badge";

export const extensionMarketplaceAddon: WebAddon = {
  id: "extension-marketplace",
  galleryItemBadges: [{ order: 10, Component: VerdictBadge }],
  // 관리자 허브 — MCP 카탈로그(85) 바로 뒤
  hubTabs: [{ hub: "admin", href: "/admin/mcp-registry", labelKey: "nav.items.mcpRegistry", order: 86 }],
  hideUntilEnabledKnown: true,
};
