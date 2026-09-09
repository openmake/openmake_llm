"use client";

/**
 * 병렬 에이전트 패널 — fan-out(spawn_agents)·위임(delegate) 서브에이전트의 진행 상태.
 *
 * 서버가 서브 하나마다 수명(queued→started→…→final/error)을 남기므로(109 + 수명 마킹),
 * 실행 중에도 "몇 갈래가 돌고 있고 각각 어디까지 왔는지"를 그대로 보여준다. 스텝 전문은
 * 기본으로 접고 최근 활동 한 줄만 노출한다 — 서브가 여럿이면 스텝이 화면을 덮어
 * 정작 알고 싶은 갈래별 상태가 묻힌다.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Circle, CircleCheck, CircleX, CircleDot, CircleMinus, ChevronRight, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import type { ApiSuccess } from "@openmake/shared-types";
import { cn } from "@/lib/utils";

/** 진행 중 갱신 주기(ms) — 작업 상세 폴링과 같은 리듬. */
const LIVE_POLL_MS = 2500;

export type SubagentStatus = "queued" | "running" | "completed" | "failed" | "interrupted";

/** 서브에이전트 활동(109) — delegate/spawn 서브 1개 = trace 1개 */
export interface SubagentTraceView {
  traceId: string;
  origin: string;
  subIndex: number;
  label: string | null;
  status: SubagentStatus;
  startedAt: string;
  finishedAt: string | null;
  steps: { seq: number; type: string; tool: string | null; content: string | null; at: string }[];
}

const STATUS_ICON: Record<SubagentStatus, LucideIcon> = {
  queued: Circle,
  running: CircleDot,
  completed: CircleCheck,
  failed: CircleX,
  interrupted: CircleMinus,
};

const STATUS_TONE: Record<SubagentStatus, "neutral" | "accent" | "success" | "danger" | "warn"> = {
  queued: "neutral",
  running: "accent",
  completed: "success",
  failed: "danger",
  interrupted: "warn",
};

const STATUS_COLOR: Record<SubagentStatus, string> = {
  queued: "text-faint",
  running: "text-accent",
  completed: "text-success",
  failed: "text-danger",
  interrupted: "text-warn",
};

/** 접힌 상태에서 보여줄 최근 활동 — 진행 중인 서브가 살아 있음을 한 줄로 알린다. */
function lastActivity(tr: SubagentTraceView): { tool: string | null; text: string } | null {
  for (let i = tr.steps.length - 1; i >= 0; i--) {
    const s = tr.steps[i];
    if (s.type === "queued" || s.type === "started") continue;
    return { tool: s.tool, text: (s.content ?? "").replace(/\s+/g, " ").trim() };
  }
  return null;
}

export function SubagentPanel({ traces }: { traces: SubagentTraceView[] }) {
  const t = useTranslations("agentTasks");
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (traces.length === 0) return null;

  const done = traces.filter((tr) => tr.status === "completed").length;
  const running = traces.filter((tr) => tr.status === "running").length;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="rounded-md border border-border bg-surface-1 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-fg-2">{t("subagents.title", { count: traces.length })}</p>
        <span className="font-mono text-[11px] text-faint">
          {t("subagents.summary", { done, total: traces.length })}
          {running > 0 ? ` · ${t("subagents.runningCount", { count: running })}` : ""}
        </span>
      </div>

      {/* 좌측 세로선 = fan-out 한 갈래씩. 실행 스텝 타임라인과 같은 시각 언어를 쓴다. */}
      <ul className="space-y-1 border-l border-border pl-3">
        {traces.map((tr) => {
          const key = `${tr.traceId}:${tr.subIndex}`;
          const expanded = open.has(key);
          const Icon = STATUS_ICON[tr.status];
          const activity = lastActivity(tr);
          const name = tr.label
            ?? (tr.origin === "spawn_agents" ? t("subagents.originSpawn", { n: tr.subIndex + 1 }) : t("subagents.originDelegate"));
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => toggle(key)}
                aria-expanded={expanded}
                className="flex w-full items-start gap-2 rounded px-1 py-1 text-left transition hover:bg-surface-2"
              >
                <Icon
                  className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", STATUS_COLOR[tr.status], tr.status === "running" && "animate-pulse")}
                  aria-label={tr.status}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-xs text-fg-2">{name}</span>
                    <Badge tone={STATUS_TONE[tr.status]}>{t(`subagents.status.${tr.status}`)}</Badge>
                    {tr.steps.length > 0 && (
                      <span className="font-mono text-[11px] text-faint">{t("subagents.stepCount", { count: tr.steps.length })}</span>
                    )}
                  </span>
                  {/* 접혀 있어도 지금 무엇을 하는 중인지는 보인다. */}
                  {!expanded && activity && (
                    <span className="mt-0.5 flex gap-1.5 text-[11px] text-muted">
                      {activity.tool && <span className="shrink-0 font-mono text-faint">{activity.tool}</span>}
                      <span className="min-w-0 flex-1 truncate">{activity.text}</span>
                    </span>
                  )}
                </span>
                <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-faint transition", expanded && "rotate-90")} />
              </button>

              {expanded && (
                <ul className="space-y-0.5 py-1 pl-6">
                  {tr.steps.map((st) => (
                    <li key={st.seq} className="flex gap-2 text-[11px]">
                      <span className={cn(
                        "shrink-0 font-mono",
                        st.type === "error" ? "text-danger" : st.type === "final" ? "text-success" : "text-faint",
                      )}>
                        {st.tool ?? st.type}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-muted" title={st.content ?? ""}>{st.content}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type SubagentsResponse = ApiSuccess<{ traces: SubagentTraceView[] }>;

/**
 * 채팅 인라인용 — 작업 id 로 직접 조회한다. 채팅이 에이전트 작업의 주 진입점이라, 여기서
 * fan-out 이 안 보이면 병렬로 돌고 있다는 사실 자체를 사용자가 알 수 없다.
 * 조회 실패·fan-out 없음은 조용히 아무것도 그리지 않는다(부가 정보라 본 카드를 방해하지 않음).
 */
export function LiveSubagentPanel({ taskId, active }: { taskId: string; active: boolean }) {
  const [traces, setTraces] = useState<SubagentTraceView[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const r = await ApiClient.get<SubagentsResponse>(`/api/agent-tasks/${taskId}/subagents`);
        if (!cancelled) setTraces(r?.data?.traces ?? []);
      } catch { /* 부가 정보 — 실패해도 카드는 그대로 */ }
      if (!cancelled && active) timer = setTimeout(load, LIVE_POLL_MS);
    };
    void load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [taskId, active]);

  return <SubagentPanel traces={traces} />;
}
