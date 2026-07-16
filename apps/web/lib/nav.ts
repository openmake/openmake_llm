import {
  Bot,
  LayoutGrid,
  MessageSquare,
  Shield,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

/** 최소 가시 역할 — 백엔드 권한과 정합 (guest<user<admin). 항목별 minRole, 미지정 시 'user'. */
export type NavRole = "guest" | "user" | "admin";
export const NAV_ROLE_RANK: Record<NavRole, number> = { guest: 0, user: 1, admin: 2 };

export interface NavItem {
  /** messages/*.json 의 nav 네임스페이스 키 (예: 'items.chat') */
  labelKey: string;
  href: string;
  icon: LucideIcon;
  /** 이 항목을 보려면 필요한 최소 역할. 미지정 시 'user'. */
  minRole?: NavRole;
}

/**
 * 사이드바 네비게이션 — 2026-07-17 2차 통폐합 (15→5 항목, 그룹 헤더 제거).
 * 사이드바는 최근 대화 목록이 주인공이 되도록 최상위 항목을 최소화한다.
 * 묶이거나 이동한 페이지들은 기존 라우트를 유지한다:
 * - 딥 리서치(/research): composer 모드 토글 + 채팅 인라인 배너로 진입 (nav 제거)
 * - 스킬 라이브러리(/skill-library): 커스텀 에이전트 허브 탭(AgentsTabs)으로 이동
 * - 히스토리(/history): 최근 대화 하단 "모두 보기" 링크로 이동
 * - MCP(/mcp-servers): 설정 '커넥터' 탭으로 흡수 (구 라우트는 redirect)
 * - 설정·사용량·개발자: 사이드바 하단 프로필 메뉴로 이동
 * - 관리자 계열(/admin/*): 단일 '관리자' 항목 + AdminTabs 허브 탭
 */
export const NAV_ITEMS: NavItem[] = [
  { labelKey: "items.chat", href: "/", icon: MessageSquare, minRole: "guest" },
  { labelKey: "items.agentTasks", href: "/agent-tasks", icon: Sparkles },
  { labelKey: "items.customAgents", href: "/custom-agents", icon: Bot },
  { labelKey: "items.artifacts", href: "/artifacts", icon: LayoutGrid },
  { labelKey: "items.admin", href: "/admin", icon: Shield, minRole: "admin" },
];

/**
 * 역할로 nav 항목을 필터한다. 항목별 minRole(미지정 시 'user')을 충족하는 항목만 남긴다.
 * role 미지정/미로그인 = 'guest'.
 */
export function visibleNavItems(role: NavRole = "guest"): NavItem[] {
  const rank = NAV_ROLE_RANK[role];
  return NAV_ITEMS.filter((it) => rank >= NAV_ROLE_RANK[it.minRole ?? "user"]);
}
