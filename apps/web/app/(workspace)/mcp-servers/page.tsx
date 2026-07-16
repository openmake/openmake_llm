import { redirect } from "next/navigation";

/** MCP 서버 관리는 설정 '커넥터' 탭으로 흡수됨 (2026-07-17 사이드바 2차 통폐합) — 딥링크 호환 redirect. */
export default function McpServersRedirect() {
  redirect("/settings?tab=connectors");
}
