/**
 * extension-marketplace 화면 경로. 서버에서 import 되므로 훅을 두지 않는다(화면 컴포넌트는 "use client").
 * - admin(`/admin/*`, 관리자 가드 안): `/admin/mcp-registry`(MCP Registry 사본·큐레이션, M7)
 */
import type { WebAddonPage } from "../../types";
import { AdminMcpRegistryPage } from "./admin-mcp-registry-page";

export const extensionMarketplacePages: readonly WebAddonPage[] = [
  { path: "mcp-registry", area: "admin", render: ({ segments }) => (segments.length === 0 ? <AdminMcpRegistryPage /> : null) },
];
