"use client";

import { useTranslations } from "next-intl";
import { PageTabs } from "@/components/ui/page-tabs";
import { useAppStore } from "@/lib/store";

/**
 * 사이드바 통폐합(2026-07-11 1차, 2026-07-17 2차)으로 묶인 허브별 탭 정의.
 * 각 허브에 속한 페이지들이 PageHeader 아래에 동일 탭 바를 렌더한다.
 * (구 McpTabs 는 2차 통폐합에서 제거 — /mcp-servers 가 설정 '커넥터' 탭으로 흡수됨.)
 */

/** 히스토리 허브 — 대화 히스토리 | 딥 리서치 (2차 통폐합으로 nav 에서 빠진 두 페이지의 진입점) */
export function HistoryTabs() {
  const t = useTranslations("pageTabs");
  return (
    <PageTabs
      tabs={[
        { href: "/history", label: t("history") },
        { href: "/research", label: t("research") },
      ]}
    />
  );
}

/** 에이전트 허브 — 커스텀 에이전트 | 스킬 라이브러리 (기존 nav.items 라벨 재사용) */
export function AgentsTabs() {
  const tNav = useTranslations("nav");
  return (
    <PageTabs
      tabs={[
        { href: "/custom-agents", label: tNav("items.customAgents") },
        { href: "/skill-library", label: tNav("items.skillLibrary") },
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
 * 관리자 허브 — 관측(대시보드~에이전트 학습) + 관리(감사 로그~모델 역할) 전체 탭.
 * 2차 통폐합으로 사이드바 관리자 항목이 /admin 하나로 줄면서 나머지가 탭으로 편입됐다.
 * /mcp-monitoring·/agent-learning 은 라우트 가드가 없어 비관리자도 URL 로 도달할 수 있다 —
 * 그 경우 /admin 계열 링크를 노출하지 않도록 admin 역할에서만 렌더.
 */
export function AdminTabs() {
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
        { href: "/admin/audit", label: tNav("items.auditLog") },
        { href: "/admin/alerts", label: tNav("items.alerts") },
        { href: "/admin/mcp-catalog", label: tNav("items.mcpCatalogAdmin") },
        { href: "/admin/model-roles", label: tNav("items.modelRolesAdmin") },
      ]}
    />
  );
}
