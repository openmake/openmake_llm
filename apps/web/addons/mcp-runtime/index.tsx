/**
 * mcp-runtime add-on (웹) — MCP 카탈로그·커넥터(설정 탭)·확장 설치분 MCP 서버 승인 섹션·관리자 MCP 모니터링/카탈로그 (2026-10-18).
 * 서버의 MCP 런타임·저장(`mcp_servers` 등)을 소유한 add-on 과 같은 id 라, 서버에서 꺼지면 `useEnabledWebAddons` 가
 * 진입점(설정 탭·승인 섹션·배지 합산·관리자 탭·바로가기)을 함께 걷는다. 화면은 pages/index.tsx → addons/pages.ts.
 */
import { Boxes, Server } from "lucide-react";
import { ApiClient } from "@/lib/api-client";
import type { WebAddon } from "../types";
import { ConnectorsSection } from "./components/connectors-section";
import { McpDrafts } from "./components/mcp-drafts";

export const mcpRuntimeAddon: WebAddon = {
  id: "mcp-runtime",
  // 관리자 허브 — 모니터링은 평가(60)와 감사 로그(70) 사이, 카탈로그는 알림(80)과 모델 역할(90) 사이(종전 자리)
  hubTabs: [
    { hub: "admin", href: "/admin/mcp-monitoring", labelKey: "nav.items.mcpMonitoring", order: 65 },
    { hub: "admin", href: "/admin/mcp-catalog", labelKey: "nav.items.mcpCatalogAdmin", order: 85 },
  ],
  // 승인함 — 스킬(20) 다음, Custom Agent(40) 앞. 승인 후 연결되어야 채팅에서 도구로 쓰인다
  approvalSections: [
    {
      id: "mcp",
      order: 30,
      Icon: Server,
      titleKey: "approvals.mcp.title",
      hintKey: "approvals.mcp.hint",
      Component: McpDrafts,
      async countPending() {
        const r = await ApiClient.get<{ data: unknown[] }>("/api/mcp/servers/drafts", { redirectOnUnauthorized: false });
        return r.data?.length ?? 0;
      },
    },
  ],
  // 설정 — 확장(60)과 개인정보(70) 사이. 행별 버튼이 즉시 저장한다
  settingsTabs: [
    { id: "connectors", order: 65, labelKey: "settings.tabs.connectors", Icon: Server, Component: ConnectorsSection, ownsSaving: true },
  ],
  // 관리자 대시보드 — 시스템(10) 앞
  adminQuickLinks: [
    { href: "/mcp-catalog", order: 5, titleKey: "admin.quickLinks.models.title", descKey: "admin.quickLinks.models.desc", Icon: Boxes },
  ],
};
