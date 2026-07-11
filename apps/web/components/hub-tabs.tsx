"use client";

import { useTranslations } from "next-intl";
import { PageTabs } from "@/components/ui/page-tabs";

/**
 * 사이드바 통폐합(2026-07-11)으로 묶인 허브별 탭 정의.
 * 각 허브에 속한 페이지들이 PageHeader 아래에 동일 탭 바를 렌더한다.
 */

/** MCP 허브 — 내 서버 | 카탈로그 */
export function McpTabs() {
  const t = useTranslations("pageTabs");
  return (
    <PageTabs
      tabs={[
        { href: "/mcp-servers", label: t("myServers") },
        { href: "/mcp-catalog", label: t("catalog") },
      ]}
    />
  );
}

/** 개발자 허브 — 문서 | API 액세스 */
export function DeveloperTabs() {
  const t = useTranslations("pageTabs");
  return (
    <PageTabs
      tabs={[
        { href: "/developer", label: t("docs") },
        { href: "/api-access", label: t("apiAccess") },
      ]}
    />
  );
}

/** 관리자 관측 허브 — 대시보드 | 애널리틱스 | 메트릭 | MCP 모니터링 | 에이전트 학습 */
export function AdminObservabilityTabs() {
  const t = useTranslations("pageTabs");
  return (
    <PageTabs
      tabs={[
        { href: "/admin", label: t("dashboard") },
        { href: "/admin/analytics", label: t("analytics") },
        { href: "/admin/metrics", label: t("metrics") },
        { href: "/mcp-monitoring", label: t("mcpMonitoring") },
        { href: "/agent-learning", label: t("agentLearning") },
      ]}
    />
  );
}
