"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Clock, CircleCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 생각 과정 타임라인 (클로드 웹식) — 접힌 상태는 요약 헤드라인 한 줄,
 * 펼치면 시계 아이콘 + 세로 연결선 + 생각 단락 + ✓ 완료 타임라인.
 *
 * 자동 동작: 생각 스트리밍 중엔 자동 펼침, 응답 본문이 시작되면 자동 접힘
 * (사용자가 수동으로 토글하면 그 선택이 우선).
 * 헤드라인은 백엔드 'summary' role 모델이 생각 종료 시 생성(thinking_summary 이벤트) —
 * 도착 전/실패 시엔 기본 라벨로 표시.
 */
export function ThinkingTimeline({
  reasoning,
  summary,
  thinkingActive,
  done,
}: {
  reasoning: string;
  /** 요약 헤드라인 (thinking_summary) — 없으면 기본 라벨 */
  summary?: string;
  /** 생각 스트리밍 진행 중 (응답 본문 시작 전) */
  thinkingActive: boolean;
  /** 생각 종료 여부 — ✓ 완료 노드 표시 */
  done: boolean;
}) {
  const t = useTranslations("chat.thinkingTimeline");
  // null = 자동(생각 중 펼침 / 본문 시작 시 접힘), true/false = 사용자 수동 토글
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const open = manualOpen ?? thinkingActive;

  // 스트리밍 중 새 생각 단락이 뷰포트 밖으로 흐르지 않게 하단 고정 스크롤
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (thinkingActive && open && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [reasoning, thinkingActive, open]);

  const paragraphs = reasoning
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const headline = summary ?? (thinkingActive ? t("thinking") : t("fallbackLabel"));

  return (
    <div className="mb-2 text-xs">
      {/* 헤드라인 (접기/펼치기 토글) */}
      <button
        type="button"
        onClick={() => setManualOpen((v) => (v === null ? !open : !v))}
        className="group flex w-full items-center gap-1.5 py-1 text-left text-muted transition-colors hover:text-fg-2"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")}
          aria-hidden
        />
        {thinkingActive ? (
          <span className="flex items-center gap-1.5">
            <span className="animate-pulse">{headline}…</span>
          </span>
        ) : (
          <span>{headline}</span>
        )}
      </button>

      {/* 타임라인 본문 */}
      {open && paragraphs.length > 0 && (
        <div
          ref={bodyRef}
          className={cn(
            "mt-1 space-y-0 pl-1",
            thinkingActive && "max-h-48 overflow-y-auto",
          )}
        >
          {paragraphs.map((p, i) => {
            const isLast = i === paragraphs.length - 1;
            const activeNode = thinkingActive && isLast;
            return (
              <div key={i} className="relative flex gap-3 pb-4">
                {/* 세로 연결선 — 마지막 노드 뒤엔 완료 노드까지 이어짐 */}
                <span
                  className="absolute left-[8px] top-5 bottom-0 w-px bg-border"
                  aria-hidden
                />
                <span className="relative z-10 mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-muted">
                  {activeNode
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    : <Clock className="h-3.5 w-3.5" aria-hidden />}
                </span>
                <p className="min-w-0 whitespace-pre-wrap leading-relaxed text-muted">{p}</p>
              </div>
            );
          })}
          {done && (
            <div className="relative flex items-center gap-3">
              <span className="relative z-10 flex h-4 w-4 shrink-0 items-center justify-center text-muted">
                <CircleCheck className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="font-medium text-muted">{t("done")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
