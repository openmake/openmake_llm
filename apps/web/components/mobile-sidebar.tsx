"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Telescope, Sparkles, Menu, X, LogIn } from "lucide-react";
import { Sidebar } from "./sidebar";
import { useAppStore } from "@/lib/store";
import { NAV_ROLE_RANK, type NavRole } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** OD lumen 모바일 시안: 하단 탭바(44px+ 터치 타깃) + "메뉴" 탭으로 전체 드로어. 데스크탑(lg)은 고정 사이드바. */
const TABS: { label: string; href: string; icon: typeof MessageSquare; minRole: NavRole }[] = [
  { label: "채팅", href: "/", icon: MessageSquare, minRole: "guest" },
  { label: "리서치", href: "/research", icon: Telescope, minRole: "user" },
  { label: "에이전트", href: "/agent-tasks", icon: Sparkles, minRole: "user" },
];

export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const user = useAppStore((s) => s.auth.currentUser);
  const roleRank = NAV_ROLE_RANK[user?.role ?? "guest"];
  const tabs = TABS.filter((t) => roleRank >= NAV_ROLE_RANK[t.minRole]);

  // 라우트 이동 시 드로어 자동 닫기
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      {/* 전체 메뉴 드로어 ("메뉴" 탭으로 열림) */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-[264px] shadow-3">
            <Sidebar />
            <button
              onClick={() => setOpen(false)}
              aria-label="메뉴 닫기"
              className="absolute right-2 top-3 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-3 hover:text-fg"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      )}

      {/* 하단 탭바 (모바일 전용) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition",
              isActive(t.href) ? "text-accent" : "text-muted hover:text-fg",
            )}
          >
            <t.icon className="h-5 w-5" />
            {t.label}
          </Link>
        ))}
        {!user && (
          <Link
            href="/login"
            className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted transition hover:text-fg"
          >
            <LogIn className="h-5 w-5" />
            로그인
          </Link>
        )}
        <button
          onClick={() => setOpen(true)}
          aria-label="전체 메뉴"
          className="flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-muted transition hover:text-fg"
        >
          <Menu className="h-5 w-5" />
          메뉴
        </button>
      </nav>
    </>
  );
}
