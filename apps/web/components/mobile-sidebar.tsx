"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./sidebar";

/** 모바일(<lg) 사이드바 드로어 + 햄버거 토글. 데스크탑은 layout 의 고정 사이드바 사용. */
export function MobileSidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // 라우트 이동 시 자동 닫기
  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="메뉴 열기"
        className="fixed left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-fg shadow-1 lg:hidden"
      >
        <Menu className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
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
    </>
  );
}
