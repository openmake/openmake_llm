"use client";

import { useTranslations } from "next-intl";
import { PageTabs } from "@/components/ui/page-tabs";
import { useAppStore } from "@/lib/store";

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

/** 개발자 허브 — 문서 | API 액세스 (기존 nav.items 라벨 재사용 — 중복 키 방지) */
export function DeveloperTabs() {
  const t = useTranslations("pageTabs");
  const tNav = useTranslations("nav");
  return (
    <PageTabs
      tabs={[
        { href: "/developer", label: t("docs") },
        { href: "/api-access", label: tNav("items.apiAccess") },
      ]}
    />
  );
}

/**
 * 관리자 관측 허브 — 대시보드 | 애널리틱스 | 메트릭 | MCP 모니터링 | 에이전트 학습.
 * /mcp-monitoring·/agent-learning 은 라우트 가드가 없어 비관리자도 URL 로 도달할 수 있다 —
 * 그 경우 /admin 계열 링크를 노출하지 않도록 admin 역할에서만 렌더.
 */
export function AdminObservabilityTabs() {
  const t = useTranslations("pageTabs");
  const tNav = useTranslations("nav");
  const role = useAppStore((s) => s.auth.currentUser?.role);
  if (role !== "admin") return null;
  return (
    <PageTabs
      tabs={[
        { href: "/admin", label: t("dashboard") },
        { href: "/admin/analytics", label: tNav("items.analytics") },
        { href: "/admin/metrics", label: tNav("items.metrics") },
        { href: "/mcp-monitoring", label: tNav("items.mcpMonitoring") },
        { href: "/agent-learning", label: tNav("items.agentLearning") },
      ]}
    />
  );
}
