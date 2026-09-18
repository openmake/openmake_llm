/**
 * 채팅 모드 진행 배너의 공용 틀 — 아이콘 · 제목(+부가 정보) · 메시지 · 진행 막대.
 */
import type { ComponentType, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export function ModeProgressFrame({
  Icon,
  title,
  extras,
  message,
  progress,
  progressSuffix,
}: {
  Icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  extras?: ReactNode;
  message?: string;
  progress: number;
  progressSuffix?: string;
}) {
  const filled = Math.round(progress / 10);
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-fg-2">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
          {title}
          {extras}
        </div>
        {message && <p className="mb-1.5 text-xs text-muted">{message}</p>}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-accent">
            {"▓".repeat(filled)}{"░".repeat(10 - filled)}
          </span>
          <span className="text-[11px] text-faint">{progress}%{progressSuffix ?? ""}</span>
        </div>
      </div>
    </div>
  );
}

/** 0~100 정수로 보정 */
export function clampPercent(v: unknown): number {
  return Math.max(0, Math.min(100, Math.round(typeof v === "number" ? v : 0)));
}
