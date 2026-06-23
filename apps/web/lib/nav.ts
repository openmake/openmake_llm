import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Clock,
  Gauge,
  GraduationCap,
  KeyRound,
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
  type LucideIcon,
} from "lucide-react";

/** 최소 가시 역할 — 백엔드 권한과 정합 (guest<user<admin). 항목>그룹>기본('user') 순 우선. */
export type NavRole = "guest" | "user" | "admin";
export const NAV_ROLE_RANK: Record<NavRole, number> = { guest: 0, user: 1, admin: 2 };

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** 이 항목을 보려면 필요한 최소 역할. 미지정 시 그룹값, 그것도 없으면 'user'. */
  minRole?: NavRole;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /** 그룹 전체의 최소 역할 (항목별 minRole 이 우선). */
  minRole?: NavRole;
}

/** 사이드바 네비게이션 — 기존 nav-items.js + pages 모듈에 대응. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "워크스페이스",
    items: [
      { label: "채팅", href: "/", icon: MessageSquare, minRole: "guest" },
      { label: "딥 리서치", href: "/research", icon: Telescope },
      { label: "에이전트 작업", href: "/agent-tasks", icon: Sparkles },
      { label: "커스텀 에이전트", href: "/custom-agents", icon: Bot },
      { label: "스킬 라이브러리", href: "/skill-library", icon: Library },
      { label: "히스토리", href: "/history", icon: Clock },
    ],
  },
  {
    title: "통합",
    items: [
      { label: "MCP 서버", href: "/mcp-servers", icon: Server },
      { label: "MCP 카탈로그", href: "/mcp-catalog", icon: Boxes },
      { label: "MCP 모니터링", href: "/mcp-monitoring", icon: Activity },
      { label: "에이전트 학습", href: "/agent-learning", icon: GraduationCap },
    ],
  },
  {
    title: "계정",
    items: [
      { label: "설정", href: "/settings", icon: Settings },
      { label: "API 키", href: "/api-keys", icon: KeyRound },
      { label: "사용량", href: "/usage", icon: BarChart3 },
      { label: "개발자 문서", href: "/developer", icon: ScrollText },
    ],
  },
  {
    title: "관리자",
    minRole: "admin",
    items: [
      { label: "관리자", href: "/admin", icon: Shield },
      { label: "애널리틱스", href: "/admin/analytics", icon: LineChart },
      { label: "감사 로그", href: "/admin/audit", icon: ScrollText },
      { label: "메트릭", href: "/admin/metrics", icon: Gauge },
      { label: "알림", href: "/admin/alerts", icon: Bell },
      { label: "MCP 카탈로그 관리", href: "/admin/mcp-catalog", icon: Boxes },
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
