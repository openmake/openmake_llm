import { redirect } from "next/navigation";

/** MCP 모니터링은 관리자 허브(/admin/*) 하위로 이동 (2026-08-26) — 딥링크 호환 redirect. */
export default function McpMonitoringRedirect() {
  redirect("/admin/mcp-monitoring");
}
