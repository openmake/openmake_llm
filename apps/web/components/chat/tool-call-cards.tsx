"use client";

import { useTranslations } from "next-intl";
import { Wrench, LoaderCircle, CircleCheck, CircleX, ChevronRight } from "lucide-react";
import type { ToolCallView } from "@/lib/tool-calls";
import { cn } from "@/lib/utils";

/**
 * 도구 호출 카드 — 답변 한 번에 모델이 부른 도구를 순서대로 보여 준다(이름·상태·걸린 시간).
 * 펼치면 인자와 결과 앞부분이 보인다. 내용은 서버가 가리고 자른 요약이다(lib/tool-calls).
 */
export function ToolCallCards({ calls }: { calls: ToolCallView[] }) {
  const t = useTranslations("chat.toolCards");
  if (calls.length === 0) return null;
  return (
    <ul className="mb-2 space-y-1" aria-label={t("label")}>
      {calls.map((c, i) => {
        const expandable = !!c.args || !!c.preview;
        const header = (
          <>
            {c.status === "running" ? (
              <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden />
            ) : c.status === "error" ? (
              <CircleX className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
            )}
            <Wrench className="h-3 w-3 shrink-0 text-faint" aria-hidden />
            <span className="min-w-0 truncate font-mono text-[11px] text-fg-2">{c.toolName}</span>
            <span className="shrink-0 text-[11px] text-muted">
              {c.status === "running" ? t("running") : c.status === "error" ? t("failed") : t("done")}
              {typeof c.durationMs === "number" && ` · ${t("duration", { seconds: (c.durationMs / 1000).toFixed(1) })}`}
            </span>
          </>
        );
        return (
          <li key={i} className="rounded-md border border-border bg-surface-2 text-xs">
            {expandable ? (
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5">
                  {header}
                  <ChevronRight className="ml-auto h-3 w-3 shrink-0 text-faint transition group-open:rotate-90" aria-hidden />
                </summary>
                <div className="space-y-1.5 border-t border-border px-2 py-1.5">
                  {c.args && <ToolCallBlock title={t("args")} body={c.args} />}
                  {c.preview && <ToolCallBlock title={t("result")} body={c.preview} danger={c.status === "error"} />}
                </div>
              </details>
            ) : (
              <div className="flex items-center gap-1.5 px-2 py-1.5">{header}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ToolCallBlock({ title, body, danger }: { title: string; body: string; danger?: boolean }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-faint">{title}</p>
      <pre className={cn("max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-3 px-2 py-1 font-mono text-[11px]", danger ? "text-danger" : "text-fg-2")}>
        {body}
      </pre>
    </div>
  );
}
