/**
 * skill-runtime add-on (웹) — 스킬 라이브러리 화면·확장 설치분 스킬 승인 섹션·입력창 `/` 스킬 메뉴 (2026-10-18).
 * 서버의 스킬 런타임·저장(`agent_skills` 등)을 소유한 add-on 과 같은 id 라, 서버에서 꺼지면 `useEnabledWebAddons` 가
 * 진입점(에이전트 허브 탭·승인 섹션·배지 합산·`/` 메뉴)을 함께 걷는다. 화면(`/skill-library`)은 pages/index.tsx → addons/pages.ts.
 */
import { Puzzle } from "lucide-react";
import { ApiClient } from "@/lib/api-client";
import type { SlashMenuViewProps, WebAddon } from "../types";
import { SkillDrafts } from "./components/skill-drafts";
import { SlashSkillMenu } from "./components/slash-skill-menu";
import { fetchSkills, groupSkillsByCategory, skillSlug, type SkillSummary } from "./skills-api";

function SlashView(p: SlashMenuViewProps) {
  return (
    <SlashSkillMenu
      skills={p.items as SkillSummary[]}
      grouped={p.grouped}
      activeIndex={p.activeIndex}
      loading={p.loading}
      onSelect={p.onSelect}
      onHover={p.onHover}
      onViewAll={p.onViewAll}
    />
  );
}

export const skillRuntimeAddon: WebAddon = {
  id: "skill-runtime",
  // 에이전트 허브 — 커스텀 에이전트(10) 다음
  hubTabs: [{ hub: "agents", href: "/skill-library", labelKey: "nav.items.skillLibrary", order: 20 }],
  // 승인함 — 에이전트 작업(10) 다음, MCP 서버(30) 앞
  approvalSections: [
    {
      id: "skills",
      order: 20,
      Icon: Puzzle,
      titleKey: "approvals.skills.title",
      hintKey: "approvals.skills.hint",
      Component: SkillDrafts,
      async countPending() {
        const r = await ApiClient.get<{ data: { total?: number; drafts?: unknown[] } }>(
          "/api/agents/skills/drafts?target=user&limit=1", { redirectOnUnauthorized: false });
        return r.data?.total ?? r.data?.drafts?.length ?? 0;
      },
    },
  ],
  // 선택 시 "/<slug> " 를 채워 서버 slash-command 매칭으로 그 스킬을 싣는다
  slashMenu: {
    queryKey: "skills",
    fetch: fetchSkills,
    arrangeGrouped: (items) => groupSkillsByCategory(items as SkillSummary[]),
    insertText: (item) => `/${skillSlug((item as SkillSummary).name)} `,
    viewAllHref: "/skill-library",
    View: SlashView,
  },
};
