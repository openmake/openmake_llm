"use client";

/**
 * 로컬 실행 worktree 격리 상태 뱃지(200) — 작업 상세와 채팅 작업 카드가 같이 쓴다.
 * 값 → 문구 대응은 lib/agent-task-isolation 이 하고, 여기서는 그리기만 한다. label 이 null 이면 아무것도 그리지 않는다.
 */
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { IsolationLabel, IsolationTone } from "@/lib/agent-task-isolation";

const TONE: Record<IsolationTone, string> = {
  accent: "border-accent bg-accent-soft text-accent",
  neutral: "border-border bg-surface-2 text-muted",
  warn: "border-warn bg-warn-soft text-warn",
};

export function IsolationBadge({ label, className }: { label: IsolationLabel | null; className?: string }) {
  const t = useTranslations("agentTasks.isolation");
  if (!label) return null;
  return (
    <span className={cn("mt-2 inline-flex max-w-full items-center break-all rounded-full border px-2 py-0.5 text-[10px] font-medium", TONE[label.tone], className)}>
      {t(label.key, label.params)}
    </span>
  );
}
