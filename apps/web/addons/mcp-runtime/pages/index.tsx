/**
 * mcp-runtime 화면 경로. 서버에서 import 되므로 훅을 두지 않는다(화면 컴포넌트는 "use client").
 * - workspace: `/mcp-catalog`(카탈로그), 구 딥링크 `/mcp-servers` → 설정 커넥터 탭, `/mcp-monitoring` → 관리자 모니터링
 * - admin(`/admin/*`, 관리자 레이아웃 가드 안): `/admin/mcp-catalog`(템플릿 관리), `/admin/mcp-monitoring`
 */
import { redirect } from "next/navigation";
import type { WebAddonPage } from "../../types";
import { AdminMcpCatalogPage } from "./admin-mcp-catalog-page";
import { McpMonitoringPage } from "./admin-mcp-monitoring-page";
import { McpCatalogPage } from "./mcp-catalog-page";

export const mcpRuntimePages: readonly WebAddonPage[] = [
  { path: "mcp-catalog", render: ({ segments }) => (segments.length === 0 ? <McpCatalogPage /> : null) },
  // MCP 서버 관리는 설정 '커넥터' 탭으로 흡수됨 (2026-07-17 사이드바 2차 통폐합) — 딥링크 호환
  { path: "mcp-servers", render: ({ segments }) => (segments.length === 0 ? redirect("/settings?tab=connectors") : null) },
  // MCP 모니터링은 관리자 허브(/admin/*) 하위로 이동 (2026-08-26) — 딥링크 호환
  { path: "mcp-monitoring", render: ({ segments }) => (segments.length === 0 ? redirect("/admin/mcp-monitoring") : null) },
  { path: "mcp-catalog", area: "admin", render: ({ segments }) => (segments.length === 0 ? <AdminMcpCatalogPage /> : null) },
  { path: "mcp-monitoring", area: "admin", render: ({ segments }) => (segments.length === 0 ? <McpMonitoringPage /> : null) },
];
