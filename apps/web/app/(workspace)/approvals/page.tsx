"use client";

/**
 * 승인 대기 — **설치된 확장 구성요소를 승인하는 단일 창구**.
 *
 * 배경: 확장을 설치하면 스킬·MCP 가 draft 로 들어오는데, 승인 화면이 스킬은
 * `/skill-library` 의 탭, MCP 는 `설정 → 커넥터` 의 서브탭으로 나뉘어 있었고 둘 다
 * 사이드바에 없었다. 실제 사용자가 "어디서 승인하는지 정말 모르겠다"고 막힌 지점이라
 * 한 페이지로 통합하고 사이드바에 노출한다(대기 건수 뱃지 포함).
 *
 * Custom Agent 는 승인 개념이 없다(실행 권한 없이 명시 선택 시에만 적용되는 페르소나라
 * 설치 즉시 활성) — 그 사실을 화면에서 알려 "왜 여기 없지"를 없앤다.
 *
 * 스킬·MCP 서버 섹션은 그 구성요소를 소유한 add-on(`skill-runtime`·`mcp-runtime`)이 `approvalSections` 로 끼운다
 * (2026-10-18) — Base 섹션은 에이전트 작업(10)·Custom Agent(40)뿐이다.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Bot, ExternalLink, ShieldQuestion } from "lucide-react";
import { PageHeader, PageBody } from "@/components/ui/primitives";
import { TaskApprovals } from "@/components/approvals/task-approvals";
import { CustomAgentDrafts } from "@/components/approvals/custom-agent-drafts";
import { useEnabledWebAddons } from "@/addons/registry";
import { cn } from "@/lib/utils";

export default function ApprovalsPage() {
  const t = useTranslations("approvals");
  const tRoot = useTranslations();
  // 한쪽에서 승인하면 다른 섹션의 개수 표시도 갱신되도록 공용 리프레시 키를 쓴다
  const [, setTick] = useState(0);
  const refresh = () => setTick((n) => n + 1);
  // 확장 구성요소(스킬·MCP 서버 등)의 승인 섹션은 그 구성요소를 소유한 add-on 이 준다 — 꺼진 add-on 의 섹션은 없다
  const enabledAddons = useEnabledWebAddons();
  const addonSections = useMemo(() => enabledAddons.flatMap((a) => a.approvalSections ?? []), [enabledAddons]);

  const sections: { id: string; order: number; node: ReactNode }[] = [
    {
      // 에이전트 작업 HITL — 작업이 실제로 멈춰 대기 중이라 맨 위에 둔다
      id: "tasks",
      order: 10,
      node: (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <ShieldQuestion className="h-4 w-4 text-accent" />
            {t("tasks.title")}
          </h2>
          <p className="text-xs text-muted">{t("tasks.hint")}</p>
          <TaskApprovals onRefreshAction={refresh} />
        </>
      ),
    },
    ...addonSections.map((sec) => ({
      id: sec.id,
      order: sec.order,
      node: (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <sec.Icon className="h-4 w-4 text-accent" />
            {tRoot(sec.titleKey)}
          </h2>
          <p className="text-xs text-muted">{tRoot(sec.hintKey)}</p>
          <sec.Component onRefreshAction={refresh} />
        </>
      ),
    })),
    {
      // Custom Agent — Git URL 가져오기 draft 만 승인 대상. 확장 설치분은 즉시 활성이라
      // 여기엔 안 뜬다(그 사실도 hint 로 알린다). 구 /custom-agents "Draft 검토" 탭을 이관
      id: "agents",
      order: 40,
      node: (
        <>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Bot className="h-4 w-4 text-accent" />
            {t("agents.title")}
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted">{t("agents.hint")}</p>
            <Link
              href="/custom-agents"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {t("agents.link")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
          <CustomAgentDrafts onRefreshAction={refresh} />
        </>
      ),
    },
  ];
  sections.sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={t("title")} description={t("description")} />

      <PageBody className="space-y-6">
        {sections.map((sec, i) => (
          <section key={sec.id} className={cn("space-y-3", i > 0 && "border-t border-border pt-6")}>
            {sec.node}
          </section>
        ))}
      </PageBody>
    </div>
  );
}
