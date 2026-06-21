import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Clock,
  FolderKanban,
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

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** 사이드바 네비게이션 — 기존 nav-items.js + pages 모듈에 대응. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "워크스페이스",
    items: [
      { label: "채팅", href: "/", icon: MessageSquare },
      { label: "딥 리서치", href: "/research", icon: Telescope },
      { label: "에이전트 작업", href: "/agent-tasks", icon: Sparkles },
      { label: "커스텀 에이전트", href: "/custom-agents", icon: Bot },
      { label: "프로젝트", href: "/projects", icon: FolderKanban },
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
    ],
  },
  {
    title: "관리자",
    items: [
      { label: "관리자", href: "/admin", icon: Shield },
      { label: "애널리틱스", href: "/admin/analytics", icon: LineChart },
      { label: "감사 로그", href: "/admin/audit", icon: ScrollText },
      { label: "메트릭", href: "/admin/metrics", icon: Gauge },
      { label: "알림", href: "/admin/alerts", icon: Bell },
    ],
  },
];
