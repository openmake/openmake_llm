"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  LogOut,
  Trash2,
  Settings,
  BarChart3,
  Terminal,
  ChevronsUpDown,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ApiSuccess } from "@openmake/shared-types";
import { useAppStore } from "@/lib/store";
import type { ChatRole } from "@/lib/store";
import { visibleNavItems } from "@/lib/nav";
import { ApiClient } from "@/lib/api-client";
import { appendAnonSessionId } from "@/lib/anon-session";
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
  const t = useTranslations("sidebar");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { clearChat, auth, setAuth, setChatHistory, setCurrentSessionId, setArtifacts } =
    useAppStore();
  const user = auth.currentUser;
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 라우트 이동·바깥 클릭 시 프로필 메뉴 닫기
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  // 지난 대화 클릭 → 해당 세션 메시지 로드 + 채팅 화면으로 전환.
  const openSession = async (sid?: string) => {
    if (!sid) return;
    setArtifacts([]); // 이전 세션 아티팩트 비움 → 패널이 새 세션 것 재복원
    setCurrentSessionId(sid);
    // 노트북 컨텍스트는 대화 스코프 — 다른 대화로 누수 방지
    useAppStore.getState().setNotebookContext(null);
    try {
      const res = await ApiClient.get<
        ApiSuccess<{ messages?: Array<{ role: string; content: string; images?: string[]; thinking?: string; reasoningSummary?: string }> }>
      >(appendAnonSessionId(`/api/chat/sessions/${sid}/messages`));
      const msgs = res?.data?.messages ?? [];
      setChatHistory(() =>
        msgs
          .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
          .map((m) => ({
            role: m.role as ChatRole,
            content: m.content,
            images: m.images,
            // 영속화된 생각 과정 — 재열람 시 타임라인 표시 (접힘 상태)
            reasoning: m.thinking || undefined,
            reasoningSummary: m.reasoningSummary || undefined,
          })),
      );
    } catch {
      /* 조회 실패 — 무시 */
    }
    if (pathname !== "/") router.push("/");
  };

  // 최근 대화 삭제 — 백엔드 DELETE /api/chat/sessions/:sid (소유자/익명 소유 검증).
  const deleteSession = async (sid: string, title: string) => {
    if (!window.confirm(t("deleteConfirm", { title }))) return;
    try {
      await ApiClient.del(appendAnonSessionId(`/api/chat/sessions/${sid}`));
      if (sid === currentSessionId) clearChat();
      void queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch {
      window.alert(t("deleteFailed"));
    }
  };

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
        appendAnonSessionId("/api/chat/conversations"),
      );
      return res?.data?.sessions ?? [];
    },
    retry: false,
  });

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  // 사이드바 검색 — 최근 대화 제목 필터 (전체 검색은 히스토리 페이지)
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSessions = normalizedQuery
    ? sessions.filter((s) =>
        (s.title ?? s.name ?? t("untitledChat")).toLowerCase().includes(normalizedQuery),
      )
    : sessions;

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
          <Plus className="h-4 w-4" />
          {t("newChat")}
        </Link>
      </div>

      <div className="px-3 pt-3">
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2">
          <Search className="h-4 w-4 text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />
        </div>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-0.5 pt-1">
          {visibleNavItems(user?.role ?? "guest").map((item) => (
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
                {tNav(item.labelKey)}
              </Link>
            </li>
          ))}
        </ul>

        {sessions.length > 0 && (
          <div className="pt-3">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-faint">
              {t("recentChats")}
            </p>
            {filteredSessions.length === 0 && (
              <p className="px-2.5 py-1.5 text-sm text-faint">{t("noResults")}</p>
            )}
            <ul className="space-y-0.5">
              {filteredSessions.slice(0, 20).map((s, i) => {
                const sid = s.id ?? s.sessionId;
                const active = !!sid && sid === currentSessionId;
                const title = s.title ?? s.name ?? t("untitledChat");
                return (
                  <li key={sid ?? i} className="group relative">
                    <button
                      type="button"
                      onClick={() => openSession(sid)}
                      className={cn(
                        "w-full truncate rounded-md px-2.5 py-1.5 text-left text-sm transition group-hover:pr-8",
                        active
                          ? "bg-accent-soft font-medium text-accent"
                          : "text-muted hover:bg-surface-3 hover:text-fg",
                      )}
                    >
                      {title}
                    </button>
                    {sid && (
                      <button
                        type="button"
                        aria-label={t("deleteChat")}
                        onClick={() => void deleteSession(sid, title)}
                        className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-faint opacity-0 transition group-hover:opacity-100 hover:bg-surface-3 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {/* 히스토리 진입점 — 최근 대화 유무와 무관하게 상시 노출 (없으면 이 링크가 /history 유일 경로) */}
        <Link
          href="/history"
          className="mt-1 flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          {t("viewAll")} →
        </Link>
      </nav>

      <div ref={menuRef} className="relative flex items-center gap-2.5 border-t border-border px-3 py-3">
        {/* 계정 메뉴 팝오버 — 설정·사용량·개발자·로그아웃 (2026-07-17 사이드바 2차 통폐합) */}
        {user && menuOpen && (
          <div className="absolute bottom-full left-3 z-40 mb-1 w-[232px] rounded-lg border border-border bg-surface p-1 shadow-3">
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-2 transition hover:bg-surface-3 hover:text-fg"
            >
              <Settings className="h-4 w-4" />
              {tNav("items.settings")}
            </Link>
            <Link
              href="/usage"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-2 transition hover:bg-surface-3 hover:text-fg"
            >
              <BarChart3 className="h-4 w-4" />
              {tNav("items.usage")}
            </Link>
            <Link
              href="/developer"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-2 transition hover:bg-surface-3 hover:text-fg"
            >
              <Terminal className="h-4 w-4" />
              {tNav("items.developer")}
            </Link>
            <div className="my-1 border-t border-border" />
            <button
              type="button"
              onClick={() => void logout()}
              className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-fg-2 transition hover:bg-surface-3 hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
              {t("logout")}
            </button>
          </div>
        )}
        {user ? (
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={t("accountMenu")}
            aria-expanded={menuOpen}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 -m-1 text-left transition hover:bg-surface-3"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-m-pro/15 text-xs font-bold text-m-pro">
              {user.name?.[0] ?? "G"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{user.name ?? t("guest")}</p>
              <p className="truncate text-xs text-faint">{user.role} · {t("selfHosted")}</p>
            </div>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" />
          </button>
        ) : (
          <Link
            href="/login"
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md transition hover:opacity-80"
          >
            <div className="grid h-8 w-8 place-items-center rounded-full bg-m-pro/15 text-xs font-bold text-m-pro">
              G
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{t("guest")}</p>
              <p className="truncate text-xs text-faint">{t("notLoggedIn")}</p>
            </div>
          </Link>
        )}
        <ThemeToggle />
      </div>
    </aside>
  );
}
