"use client";

import { useRef, type ReactNode, type WheelEvent } from "react";

/**
 * 채팅 스크롤 영역 — 스크롤 박스를 본문 기둥(max-w-3xl) 폭으로 두어 스크롤바가 본문 오른쪽에 붙게 한다.
 * 기둥 밖 여백에서 굴린 휠은 안쪽 스크롤러로 넘긴다(안쪽에서 난 휠은 브라우저 기본 동작).
 */
export function ChatScrollArea({ children }: { children: ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller || e.deltaY === 0 || scroller.contains(e.target as Node)) return;
    // deltaMode: 0 픽셀, 1 줄(×16), 2 페이지(×clientHeight)
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? scroller.clientHeight : 1;
    scroller.scrollBy({ top: e.deltaY * unit });
  };

  return (
    <div className="flex min-h-0 flex-1 justify-center" onWheel={onWheel}>
      {/* relative — 메시지 안 absolute 요소(sr-only)가 이 스크롤 박스를 기준으로 놓이고 함께 스크롤되게(셸 밖으로 새지 않게) */}
      <div ref={scrollerRef} className="relative h-full w-full max-w-3xl overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
