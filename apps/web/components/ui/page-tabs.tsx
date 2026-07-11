"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface PageTab {
  /** 이동할 라우트 (기존 표준 라우트 유지 — 탭은 라우트 간 링크) */
  href: string;
  label: string;
}

/**
 * 통합 허브용 서브 내비게이션 탭 바 — PageHeader 바로 아래에 배치한다.
 * 사이드바 통폐합으로 묶인 페이지들(MCP, 개발자, 관리자 관측)이 기존 라우트를
 * 유지한 채 서로를 탭으로 오가는 링크 집합. 활성 판정은 pathname 완전 일치.
 */
export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border px-6 py-2">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition",
              active
                ? "bg-accent-soft text-accent"
                : "text-fg-2 hover:bg-surface-2 hover:text-fg",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
