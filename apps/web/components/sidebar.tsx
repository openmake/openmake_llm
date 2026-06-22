"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, Search, LogOut } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { ApiSuccess } from "@openmake/shared-types";
import { useAppStore } from "@/lib/store";
import { NAV_GROUPS } from "@/lib/nav";
import { ApiClient } from "@/lib/api-client";
import Image from "next/image";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

interface SessionRow {
  id?: string;
  sessionId?: string;
  title?: string;
  name?: string;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { clearChat, auth, setAuth } = useAppStore();
  const user = auth.currentUser;

  const logout = async () => {
    try {
      await ApiClient.post("/api/auth/logout");
    } catch {
      /* 실패해도 진행 */
    }
    setAuth({ currentUser: null, isGuestMode: true });
    router.push("/login");
  };

  // 최근 대화 — /api/chat/conversations ({data:{sessions:[]}}). 실패/빈이면 목록 숨김.
  const { data: sessions = [] } = useQuery<SessionRow[]>({
    queryKey: ["conversations"],
    queryFn: async () => {
      const res = await ApiClient.get<ApiSuccess<{ sessions?: SessionRow[] }>>(
        "/api/chat/conversations",
      );
      return res?.data?.sessions ?? [];
    },
    retry: false,
  });

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="flex h-full w-[264px] flex-col border-r border-border bg-surface-2/60">
      <Link href="/" className="flex items-center gap-2 px-4 pt-4 transition hover:opacity-80">
        <Image
          src="/logo.png"
          alt="OpenMake"
          width={28}
          height={28}
          className="h-7 w-7 rounded-md object-contain"
        />
        <span className="text-sm font-semibold text-fg">OpenMake</span>
      </Link>

      <div className="px-3 pt-3">
        <Link
          href="/"
          onClick={() => clearChat()}
          className="flex w-full items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg shadow-2 transition hover:bg-accent-hover active:bg-accent-press"
        >
          <Plus className="h-4 w-4" />새 대화
        </Link>
      </div>

      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input
            placeholder="검색..."
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-faint"
          />
        </div>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-3 pb-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="pt-3">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition",
                      isActive(item.href)
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-fg-2 hover:bg-surface-3 hover:text-fg",
                    )}
                  >
                    <item.icon className="h-[18px] w-[18px]" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {sessions.length > 0 && (
          <div className="pt-3">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              최근 대화
            </p>
            <ul className="space-y-0.5">
              {sessions.slice(0, 20).map((s, i) => (
                <li key={s.id ?? s.sessionId ?? i}>
                  <button className="w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm text-muted transition hover:bg-surface-3 hover:text-fg">
                    {s.title ?? s.name ?? "제목 없는 대화"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-border px-3 py-3">
        {user ? (
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-m-pro/15 text-xs font-bold text-m-pro">
              {user.name?.[0] ?? "G"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{user.name ?? "게스트"}</p>
              <p className="truncate text-xs text-faint">{user.role} · 자가호스팅</p>
            </div>
          </div>
        ) : (
          <Link
            href="/login"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md transition hover:opacity-80"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-m-pro/15 text-xs font-bold text-m-pro">
              G
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">게스트</p>
              <p className="truncate text-xs text-faint">로그인 안 됨</p>
            </div>
          </Link>
        )}
        <ThemeToggle />
        {user && (
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="로그아웃"
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition hover:bg-surface-3 hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
