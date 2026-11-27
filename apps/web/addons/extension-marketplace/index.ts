/**
 * extension-marketplace add-on (웹) — 확장 갤러리 항목 옆 호환 판정 배지(지원·부분 지원·불가 + 사유·출처).
 * 서버 매니페스트가 `defaultState: "disabled"` 라 켜짐을 확인하기 전에는 숨긴다 — 꺼져 있으면 갤러리는 종전 그대로다.
 */
import type { WebAddon } from "../types";
import { VerdictBadge } from "./components/verdict-badge";

export const extensionMarketplaceAddon: WebAddon = {
  id: "extension-marketplace",
  galleryItemBadges: [{ order: 10, Component: VerdictBadge }],
  hideUntilEnabledKnown: true,
};
