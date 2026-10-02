"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/lib/store";
import { ApiClient } from "@/lib/api-client";
import { onAgentTaskChange } from "@/lib/agent-task-change";
import { summarizeActivity, type ActivityApproval, type ActivityTask } from "@/lib/activity-summary";
import { ACTIVITY_OPEN_POLL_MS, ACTIVITY_POLL_MS } from "@/lib/constants/ui-limits";
import { cn } from "@/lib/utils";

/**
 * "지금 무엇을 하는지" 통합 상태 — 승인함·작업 화면에 흩어진 것을 사이드바 한 곳에서 본다.
 * 입력 필요(내 대기 승인·질문) / 진행 중(에이전트 작업·채팅 생성) / 최근 끝남. 항목은 해당 화면으로 가는 링크다.
 */
export function ActivityStatus() {
  const t = useTranslations("activity");
  const user = useAppStore((s) => s.auth.currentUser);
  const chatGenerating = useAppStore((s) => s.isGenerating);
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<ActivityTask[]>([]);
  const [approvals, setApprovals] = useState<ActivityApproval[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const opts = { redirectOnUnauthorized: false } as const;
    // 한쪽이 실패해도 다른 쪽은 보이게 따로 받는다. 실패하면 직전 값을 둔다.
    const [tk, ap] = await Promise.all([
      ApiClient.get<{ data: { tasks: ActivityTask[] } }>("/api/agent-tasks", opts).catch(() => null),
      ApiClient.get<{ data: { pending: ActivityApproval[] } }>("/api/agent-tasks/approvals/pending", opts).catch(() => null),
    ]);
    if (tk?.data?.tasks) setTasks(tk.data.tasks);
    if (ap?.data?.pending) setApprovals(ap.data.pending);
    setNow(Date.now());
  }, []);

  const userId = user?.id;
  useEffect(() => {
    if (!userId) { setTasks([]); setApprovals([]); return; }
    void load();
    // 패널을 열어 보고 있을 때는 더 자주 읽는다
    const timer = setInterval(() => void load(), open ? ACTIVITY_OPEN_POLL_MS : ACTIVITY_POLL_MS);
    const off = onAgentTaskChange((c) => { if (c.reason !== "plan_edited") void load(); });
    return () => { clearInterval(timer); off(); };
  }, [userId, open, load]);

  const summary = summarizeActivity({ tasks, approvals, chatGenerating, now });
  const empty = summary.badge === 0 && summary.recent.length === 0;
  const itemClass = "block rounded-md px-2 py-1.5 text-[12px] leading-snug text-fg-2 transition hover:bg-surface-3 hover:text-fg";

  return (
    <div className="px-3 pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-fg-2 transition hover:bg-surface-3 hover:text-fg"
      >
        {summary.running.length > 0 || chatGenerating
          ? <Loader2 className="h-4 w-4 animate-spin text-accent" />
          : <Activity className="h-4 w-4 text-faint" />}
        {t("title")}
        {summary.badge > 0 && (
          <span
            className={cn(
              "ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white",
              summary.needsInput.length > 0 ? "bg-warn" : "bg-accent",
            )}
            title={t("badge", { needs: summary.needsInput.length, running: summary.running.length + (chatGenerating ? 1 : 0) })}
          >
            {summary.badge}
          </span>
        )}
        <ChevronDown className={cn("h-3.5 w-3.5 text-faint transition", summary.badge === 0 && "ml-auto", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-surface p-1">
          {empty && <p className="px-2 py-2 text-[12px] text-faint">{t("empty")}</p>}

          {summary.needsInput.length > 0 && (
            <section>
              <p className="px-2 pt-1 text-[11px] font-medium text-warn">{t("needsInput")}</p>
              {summary.needsInput.map((n) => (
                <Link key={n.approvalId} href="/approvals" className={itemClass}>
                  <span className="line-clamp-2">{n.question ?? t("approvalFor", { tool: n.toolName })}</span>
                  {n.goal && <span className="block truncate text-[11px] text-faint">{n.goal}</span>}
                </Link>
              ))}
            </section>
          )}

          {(summary.running.length > 0 || chatGenerating) && (
            <section>
              <p className="px-2 pt-1 text-[11px] font-medium text-accent">{t("running")}</p>
              {chatGenerating && <Link href="/" className={itemClass}>{t("chatGenerating")}</Link>}
              {summary.running.map((r) => (
                <Link key={r.id} href={`/agent-tasks?task=${encodeURIComponent(r.id)}`} className={itemClass}>
                  <span className="line-clamp-2">{r.goal}</span>
                  <span className="block text-[11px] text-faint">
                    {t(`status.${r.status}`)}{r.progress > 0 ? ` · ${Math.round(r.progress)}%` : ""}
                  </span>
                </Link>
              ))}
            </section>
          )}

          {summary.recent.length > 0 && (
            <section>
              <p className="px-2 pt-1 text-[11px] font-medium text-faint">{t("recent")}</p>
              {summary.recent.map((r) => (
                <Link key={r.id} href={`/agent-tasks?task=${encodeURIComponent(r.id)}`} className={itemClass}>
                  <span className="line-clamp-2">{r.goal}</span>
                  <span className={cn("block text-[11px]", r.status === "completed" ? "text-success" : r.status === "failed" ? "text-danger" : "text-faint")}>
                    {t(`status.${r.status}`)}
                  </span>
                </Link>
              ))}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
