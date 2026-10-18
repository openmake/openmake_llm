"use client";

import { useTranslations } from "next-intl";
import { PageTabs } from "@/components/ui/page-tabs";
import { useEnabledWebAddons } from "@/addons/registry";
import type { HubId } from "@/addons/types";
import { useAppStore } from "@/lib/store";

/**
 * 사이드바 통폐합(2026-07-11 1차, 2026-07-17 2차)으로 묶인 허브별 탭 정의.
 * 각 허브에 속한 페이지들이 PageHeader 아래에 동일 탭 바를 렌더한다.
 * (구 McpTabs 는 2차 통폐합에서 제거 — /mcp-servers 가 설정 '커넥터' 탭으로 흡수됨.)
 * add-on 화면의 탭은 레지스트리의 `hubTabs` 가 끼운다(켜진 add-on 만) — Base 탭의 순서 값은 10 단위.
 */

type Tab = { href: string; label: string };

/** Base 탭 뒤·사이에 켜진 add-on 의 탭을 순서 값으로 끼운다 */
function useHubTabs(hub: HubId, base: readonly Tab[]): Tab[] {
  const t = useTranslations();
  const addons = useEnabledWebAddons();
  const ordered = [
    ...base.map((tab, i) => ({ ...tab, order: (i + 1) * 10 })),
    ...addons.flatMap((a) => a.hubTabs ?? []).filter((x) => x.hub === hub).map((x) => ({ href: x.href, label: t(x.labelKey), order: x.order })),
  ];
  return ordered.sort((a, b) => a.order - b.order).map(({ href, label }) => ({ href, label }));
}

/** 히스토리 허브 — 대화 히스토리 (+ add-on 탭: 딥 리서치) */
export function HistoryTabs() {
  const t = useTranslations("pageTabs");
  const tabs = useHubTabs("history", [{ href: "/history", label: t("history") }]);
  return <PageTabs tabs={tabs} />;
}

/** 에이전트 허브 — 커스텀 에이전트 (+ add-on 탭: 스킬 라이브러리) */
export function AgentsTabs() {
  const tNav = useTranslations("nav");
  const tabs = useHubTabs("agents", [
    { href: "/custom-agents", label: tNav("items.customAgents") },
  ]);
  return <PageTabs tabs={tabs} />;
}

/** 개발자 허브 — 문서 | API 액세스 (기존 nav.items 라벨 재사용 — 중복 키 방지) */
export function DeveloperTabs() {
  const t = useTranslations("pageTabs");
  const tNav = useTranslations("nav");
  const tabs = useHubTabs("developer", [
    { href: "/developer", label: t("docs") },
    { href: "/api-access", label: tNav("items.apiAccess") },
  ]);
  return <PageTabs tabs={tabs} />;
}

/**
 * 관리자 허브 — 관측(대시보드~에이전트 학습) + 관리(감사 로그~모델 역할) 전체 탭(+ add-on 탭: MCP 모니터링·MCP 카탈로그).
 * 2차 통폐합으로 사이드바 관리자 항목이 /admin 하나로 줄면서 나머지가 탭으로 편입됐다.
 * /admin/* 는 관리자 가드(AdminGuard)가 막지만, 탭 자체도 admin 역할에서만 렌더한다 —
 * 그 경우 /admin 계열 링크를 노출하지 않도록 admin 역할에서만 렌더.
 */
export function AdminTabs() {
  const t = useTranslations("pageTabs");
  const tNav = useTranslations("nav");
  const role = useAppStore((s) => s.auth.currentUser?.role);
  // 훅은 역할 확인보다 먼저 — 역할이 바뀌어도 훅 호출 순서가 같아야 한다
  const tabs = useHubTabs("admin", [
    { href: "/admin", label: t("dashboard") },
    { href: "/admin/conversations", label: tNav("items.conversationsAdmin") },
    { href: "/admin/analytics", label: tNav("items.analytics") },
    { href: "/admin/metrics", label: tNav("items.metrics") },
    { href: "/admin/slo", label: tNav("items.sloAdmin") },
    { href: "/admin/evaluations", label: tNav("items.evaluationsAdmin") },
    { href: "/admin/audit", label: tNav("items.auditLog") },
    { href: "/admin/alerts", label: tNav("items.alerts") },
    { href: "/admin/model-roles", label: tNav("items.modelRolesAdmin") },
    { href: "/admin/system-settings", label: tNav("items.systemSettingsAdmin") },
    { href: "/admin/addons", label: tNav("items.addonsAdmin") },
    { href: "/admin/organizations", label: tNav("items.organizationsAdmin") },
    { href: "/admin/cost-rates", label: tNav("items.costRatesAdmin") },
    { href: "/admin/bridge-devices", label: tNav("items.bridgeDevicesAdmin") },
    { href: "/admin/agent-task-metrics", label: tNav("items.agentTaskMetricsAdmin") },
    { href: "/admin/quota-requests", label: tNav("items.quotaRequestsAdmin") },
    { href: "/admin/schedules", label: tNav("items.schedulesAdmin") },
  ]);
  if (role !== "admin") return null;
  return <PageTabs tabs={tabs} />;
}
