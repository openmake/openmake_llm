import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Clock,
  Gauge,
  GraduationCap,
  KeyRound,
  LayoutGrid,
  Library,
  LineChart,
  MessageSquare,
  ScrollText,
  Server,
  Settings,
  Shield,
  Sparkles,
  Telescope,
  Boxes,
  Terminal,
  type LucideIcon,
} from "lucide-react";

/** 최소 가시 역할 — 백엔드 권한과 정합 (guest<user<admin). 항목>그룹>기본('user') 순 우선. */
export type NavRole = "guest" | "user" | "admin";
export const NAV_ROLE_RANK: Record<NavRole, number> = { guest: 0, user: 1, admin: 2 };

export interface NavItem {
  /** messages/*.json 의 nav 네임스페이스 키 (예: 'items.chat') */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /** 이 항목을 보려면 필요한 최소 역할. 미지정 시 그룹값, 그것도 없으면 'user'. */
  minRole?: NavRole;
}

export interface NavGroup {
  /** messages/*.json 의 nav 네임스페이스 키 (예: 'groups.workspace') */
  titleKey: string;
  items: NavItem[];
  /** 그룹 전체의 최소 역할 (항목별 minRole 이 우선). */
  minRole?: NavRole;
}

/** 사이드바 네비게이션 — 기존 nav-items.js + pages 모듈에 대응. */
export const NAV_GROUPS: NavGroup[] = [
  {
    titleKey: "groups.workspace",
    items: [
      { labelKey: "items.chat", href: "/", icon: MessageSquare, minRole: "guest" },
      { labelKey: "items.research", href: "/research", icon: Telescope },
      { labelKey: "items.agentTasks", href: "/agent-tasks", icon: Sparkles },
      { labelKey: "items.customAgents", href: "/custom-agents", icon: Bot },
      { labelKey: "items.skillLibrary", href: "/skill-library", icon: Library },
      { labelKey: "items.artifacts", href: "/artifacts", icon: LayoutGrid },
      { labelKey: "items.history", href: "/history", icon: Clock },
    ],
  },
  {
    titleKey: "groups.integrations",
    items: [
      { labelKey: "items.mcpServers", href: "/mcp-servers", icon: Server },
      { labelKey: "items.mcpCatalog", href: "/mcp-catalog", icon: Boxes },
      { labelKey: "items.mcpMonitoring", href: "/mcp-monitoring", icon: Activity },
      { labelKey: "items.agentLearning", href: "/agent-learning", icon: GraduationCap },
    ],
  },
  {
    titleKey: "groups.account",
    items: [
      { labelKey: "items.settings", href: "/settings", icon: Settings },
      { labelKey: "items.apiKeys", href: "/api-keys", icon: KeyRound },
      { labelKey: "items.apiAccess", href: "/api-access", icon: Terminal },
      { labelKey: "items.usage", href: "/usage", icon: BarChart3 },
      { labelKey: "items.developerDocs", href: "/developer", icon: ScrollText },
    ],
  },
  {
    titleKey: "groups.admin",
    minRole: "admin",
    items: [
      { labelKey: "items.admin", href: "/admin", icon: Shield },
      { labelKey: "items.analytics", href: "/admin/analytics", icon: LineChart },
      { labelKey: "items.auditLog", href: "/admin/audit", icon: ScrollText },
      { labelKey: "items.metrics", href: "/admin/metrics", icon: Gauge },
      { labelKey: "items.alerts", href: "/admin/alerts", icon: Bell },
      { labelKey: "items.mcpCatalogAdmin", href: "/admin/mcp-catalog", icon: Boxes },
    ],
  },
];

/**
 * 역할로 nav 그룹/항목을 필터한다. 항목별 minRole(없으면 그룹 minRole, 그것도 없으면 'user')을
 * 충족하는 항목만 남기고, 항목이 모두 가려진 그룹은 제외한다. role 미지정/미로그인 = 'guest'.
 */
export function visibleNavGroups(role: NavRole = "guest"): NavGroup[] {
  const rank = NAV_ROLE_RANK[role];
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((it) => rank >= NAV_ROLE_RANK[it.minRole ?? g.minRole ?? "user"]),
  })).filter((g) => g.items.length > 0);
}
