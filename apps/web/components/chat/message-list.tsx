"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Bot, MessagesSquare, Telescope, Brain, Sparkles, FileCode2, ChevronRight, LoaderCircle, Pause, CircleCheck, CircleX, Download, FileText, ShieldCheck, ThumbsUp, ThumbsDown } from "lucide-react";
import { useAppStore, type PendingApproval, type AgentTaskState } from "@/lib/store";
import { ApiClient } from "@/lib/api-client";
import { Markdown } from "./markdown";
import { StructuredAnswer } from "./structured-answer";
import { cn } from "@/lib/utils";

const ARTIFACT_PLACEHOLDER = /\[\[artifact:([^\]]+)\]\]/g;

/** 에이전트 작업 승인 대기 — 채팅 인라인 승인/거절 버튼 (paused task). */
function InlineApprovals({ approvals }: { approvals: PendingApproval[] }) {
  const t = useTranslations("chat");
  const setChatHistory = useAppStore((s) => s.setChatHistory);
  const [busy, setBusy] = useState<string | null>(null);
  if (approvals.length === 0) return null;

  async function decide(a: PendingApproval, decision: "approve" | "reject") {
    setBusy(a.approvalId);
    try {
      await ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/${decision}`, {});
      // 낙관적 제거 — 해당 approval 을 메시지에서 뺀다(승인 시 agent_task_progress 가 곧 갱신).
      setChatHistory((prev) =>
        prev.map((m) =>
          m.taskId === a.taskId
            ? { ...m, approvals: (m.approvals ?? []).filter((x) => x.approvalId !== a.approvalId) }
            : m,
        ),
      );
    } catch (e) {
      alert(t("approvals.processFailed", { error: e instanceof Error ? e.message : t("approvals.errorFallback") }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-1 space-y-2 rounded-md border border-warning-soft bg-warning-soft/50 p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
        <ShieldCheck className="h-3.5 w-3.5 text-warning" /> {t("approvals.title")}
      </p>
      {approvals.map((a) => (
        <div key={a.approvalId} className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-1 p-2">
          <div className="min-w-0">
            <span className="font-mono text-xs text-fg-2">{a.toolName}</span>
            <span className="ml-2 break-all text-xs text-muted">{JSON.stringify(a.args).slice(0, 90)}</span>
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              disabled={busy === a.approvalId}
              onClick={() => decide(a, "reject")}
              className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
            >{t("approvals.reject")}</button>
            <button
              disabled={busy === a.approvalId}
              onClick={() => decide(a, "approve")}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            >{t("approvals.approve")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** 영속화된 `[[artifact:id]]` placeholder 를 클릭 가능한 아티팩트 칩으로 렌더. */
function ArtifactChip({ id }: { id: string }) {
  const t = useTranslations("chat");
  const artifacts = useAppStore((s) => s.artifacts);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const setArtifactPanelOpen = useAppStore((s) => s.setArtifactPanelOpen);
  const title = artifacts.find((a) => a.id === id)?.title ?? t("artifactFallback");
  return (
    <button
      type="button"
      onClick={() => {
        setActiveArtifact(id);
        setArtifactPanelOpen(true);
      }}
      className="my-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-fg-2 transition hover:bg-surface-3 hover:text-fg"
    >
      <FileCode2 className="h-4 w-4 text-accent" />
      {title}
    </button>
  );
}

/** 스트리밍 중 길어지는 미완성 코드 펜스 → "아티팩트 생성 중" 표시 (완료 시 칩/패널로 대체). */
function ArtifactBuilding() {
  const t = useTranslations("chat");
  return (
    <span className="my-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm font-medium text-fg-2">
      <FileCode2 className="h-4 w-4 animate-pulse text-accent" />
      {t("artifactBuilding")}
    </span>
  );
}

/** assistant 본문 — `[[artifact:id]]` placeholder 를 칩으로, 나머지는 Markdown 으로. */
function AssistantContent({ content, streaming }: { content: string; streaming?: boolean }) {
  // 스트리밍 중 닫히지 않은(길어지는) 코드 펜스는 fence-fallback 으로 아티팩트가 될 가능성이 높다.
  // 원시 코드를 71초간 흘리는 대신 "생성 중" 인디케이터로 즉시 피드백 (완료 시 칩/패널로 교체).
  // 명시적 <artifact> 태그 경로는 ws 가 이미 라이브 패널을 열므로 여기 대상 아님.
  if (streaming && !content.includes("[[artifact:")) {
    const fenceCount = (content.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
      const lastOpen = content.lastIndexOf("```");
      const fenceOpen = content.slice(lastOpen, lastOpen + 24);
      // 렌더 가능한 lang(html/svg/mermaid/chart/react)은 즉시, 일반 코드는 길어질 때(≥12줄) 표시.
      const renderable = /```\s*(html|svg|mermaid|chart|jsx|tsx|react)/i.test(fenceOpen);
      const openLines = content.slice(lastOpen).split("\n").length;
      if (renderable || openLines >= 12) {
        const before = content.slice(0, lastOpen).trim();
        return (
          <>
            {before && <Markdown content={before} />}
            <ArtifactBuilding />
          </>
        );
      }
    }
  }
  if (!content.includes("[[artifact:")) return <Markdown content={content} />;
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(ARTIFACT_PLACEHOLDER);
  let idx = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      const text = content.slice(last, m.index).trim();
      if (text) nodes.push(<Markdown key={`t${idx}`} content={text} />);
    }
    nodes.push(<ArtifactChip key={`a${idx}`} id={m[1]} />);
    last = m.index + m[0].length;
    idx += 1;
  }
  const tail = content.slice(last).trim();
  if (tail) nodes.push(<Markdown key="tail" content={tail} />);
  return <>{nodes}</>;
}

/**
 * 질문 전송 후 첫 토큰이 오기 전까지(LLM 분석/생각 중) 표시하는 진행 인디케이터.
 * 선택된 에이전트·활성 스킬이 있으면 함께 노출해 어떤 상태인지 인지시킨다.
 */
function ThinkingIndicator({
  agent,
  skills,
}: {
  agent: { name: string; emoji?: string } | null;
  skills: string[];
}) {
  const t = useTranslations("chat");
  // 에이전트 라벨은 이모지 대신 lucide Bot 아이콘으로 표기 (active-context 바와 일관, 2026-07-04).
  const label = agent
    ? t("thinking.agentAnalyzing", { agent: agent.name })
    : skills.length > 0
      ? t("thinking.skillsApplying", { skills: skills.join(", ") })
      : t("thinking.analyzing");
  return (
    <div className="flex gap-3">
      <Image src="/logo.png" alt="OpenMake" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-md object-contain" />
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-xs font-medium text-muted">OpenMake</p>
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="flex gap-1" aria-hidden>
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:300ms]" />
          </span>
          {agent && <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          <span>{label}…</span>
        </div>
      </div>
    </div>
  );
}

const QUICK_STARTS = [
  { icon: MessagesSquare, labelKey: "quickStarts.summarize.label", promptKey: "quickStarts.summarize.prompt" },
  { icon: Telescope, labelKey: "quickStarts.research.label", promptKey: "quickStarts.research.prompt" },
  { icon: Brain, labelKey: "quickStarts.analyze.label", promptKey: "quickStarts.analyze.prompt" },
  { icon: Sparkles, labelKey: "quickStarts.brainstorm.label", promptKey: "quickStarts.brainstorm.prompt" },
];

/** 에이전트 작업 인라인 카드 — 상태별 벡터 아이콘 + 진행바 + 결과/아티팩트/산출물 + 승인 (이모지 없음). */
type TaskTone = "run" | "pause" | "ok" | "fail";
const TASK_STATUS: Record<string, { Icon: typeof Pause; spin: boolean; tone: TaskTone; badgeKey: string }> = {
  pending: { Icon: LoaderCircle, spin: true, tone: "run", badgeKey: "status.pending" },
  running: { Icon: LoaderCircle, spin: true, tone: "run", badgeKey: "status.running" },
  paused: { Icon: Pause, spin: false, tone: "pause", badgeKey: "status.paused" },
  completed: { Icon: CircleCheck, spin: false, tone: "ok", badgeKey: "status.completed" },
  failed: { Icon: CircleX, spin: false, tone: "fail", badgeKey: "status.failed" },
  cancelled: { Icon: CircleX, spin: false, tone: "fail", badgeKey: "status.cancelled" },
};
const TONE_ICON: Record<TaskTone, string> = {
  run: "bg-accent-soft text-accent",
  pause: "bg-warning-soft text-warning",
  ok: "bg-success-soft text-success",
  fail: "bg-danger-soft text-danger",
};
const TONE_BADGE: Record<TaskTone, string> = {
  run: "bg-accent-soft text-accent",
  pause: "bg-warning-soft text-warning",
  ok: "bg-success-soft text-success",
  fail: "bg-danger-soft text-danger",
};

function AgentTaskCard({ task, approvals, taskId }: { task: AgentTaskState; approvals?: PendingApproval[]; taskId?: string }) {
  const t = useTranslations("chat");
  const cfg = TASK_STATUS[task.status] ?? TASK_STATUS.running;
  const pct = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
  const Icon = cfg.Icon;
  const showProgress = task.status === "pending" || task.status === "running" || task.status === "paused";
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", TONE_ICON[cfg.tone])}>
          <Icon className={cn("h-3.5 w-3.5", cfg.spin && "animate-spin")} />
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-fg">{t("agentTask.title")}</span>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tabular-nums", TONE_BADGE[cfg.tone])}>
          {t(cfg.badgeKey)}{cfg.tone !== "ok" && task.currentTurn > 0 ? ` · ${t("agentTask.turn", { turn: task.currentTurn })}` : ""}
        </span>
      </div>
      <div className="flex flex-col gap-2.5 px-3.5 py-3">
        {task.goal && (
          <p className="text-xs text-muted"><span className="font-semibold text-fg-2">{t("agentTask.goal")}</span>&nbsp; {task.goal}</p>
        )}
        {showProgress && (
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">{pct}% · {t("agentTask.turn", { turn: task.currentTurn ?? 0 })}</span>
          </div>
        )}
        {task.result && (task.status === "completed" || task.status === "failed") && (
          <div className="border-t border-border pt-2.5 text-[13px] leading-relaxed text-fg-2">
            {/* AssistantContent 가 [[artifact:id]] placeholder 를 클릭 칩으로 변환(일반 채팅과 동일). */}
            <AssistantContent content={task.result} />
          </div>
        )}
        {/* result placeholder 에 없는 잔여 아티팩트만 보강 칩으로(중복 방지). */}
        {task.artifactIds && task.artifactIds.filter((id) => !(task.result ?? "").includes(`[[artifact:${id}]]`)).length > 0 && (
          <div className="flex flex-wrap gap-2">
            {task.artifactIds.filter((id) => !(task.result ?? "").includes(`[[artifact:${id}]]`)).map((id) => <ArtifactChip key={id} id={id} />)}
          </div>
        )}
        {task.files && task.files.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-muted">
              <Download className="h-3 w-3" /> {t("agentTask.outputs")}
            </div>
            <div className="flex flex-wrap gap-2">
              {task.files.map((f) => (
                <a
                  key={f}
                  href={`/api/agent-tasks/${taskId ?? ""}/files/download?path=${encodeURIComponent(f)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2.5 py-1 text-xs font-medium text-fg-2 hover:bg-surface-3"
                >
                  <FileText className="h-3 w-3" /> {f}
                </a>
              ))}
            </div>
          </div>
        )}
        {approvals && approvals.length > 0 && <InlineApprovals approvals={approvals} />}
      </div>
    </div>
  );
}

/** 딥리서치 진행 배너 — 스트리밍 중 단계/진행/루프를 라이브 표시. */
function ResearchProgressBanner() {
  const t = useTranslations("chat");
  const rp = useAppStore((s) => s.researchProgress);
  if (!rp) return null;
  const filled = Math.round(rp.progress / 10);
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
        <Telescope className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-fg-2">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" />
          {t("research.inProgress")}
          {rp.totalLoops > 0 && (
            <span className="text-faint">· {t("research.loop", { current: rp.currentLoop, total: rp.totalLoops })}</span>
          )}
        </div>
        {rp.message && <p className="mb-1.5 text-xs text-muted">{rp.message}</p>}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-accent">
            {"▓".repeat(filled)}{"░".repeat(10 - filled)}
          </span>
          <span className="text-[11px] text-faint">{rp.progress}%{rp.currentStep ? ` · ${rp.currentStep}` : ""}</span>
        </div>
      </div>
    </div>
  );
}

/** 메시지 피드백(👍/👎) — 백엔드 /api/chat/feedback (thumbs_up/thumbs_down) 전송. */
function FeedbackButtons({ messageId }: { messageId: string }) {
  const t = useTranslations("chat");
  const sessionId = useAppStore((s) => s.currentSessionId);
  const [sent, setSent] = useState<"thumbs_up" | "thumbs_down" | null>(null);
  const send = (signal: "thumbs_up" | "thumbs_down") => {
    if (sent) return;
    setSent(signal);
    void ApiClient.post("/api/chat/feedback", { messageId, sessionId: sessionId ?? "", signal }).catch(() => {
      setSent(null); // 실패 시 재시도 허용
    });
  };
  if (sent) {
    return <div className="mt-1.5 text-xs text-muted">{t("feedbackThanks")}</div>;
  }
  return (
    <div className="mt-1.5 flex items-center gap-1">
      <button
        type="button"
        aria-label={t("feedbackUp")}
        title={t("feedbackUp")}
        onClick={() => send("thumbs_up")}
        className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        aria-label={t("feedbackDown")}
        title={t("feedbackDown")}
        onClick={() => send("thumbs_down")}
        className="rounded-md p-1 text-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function MessageList() {
  const t = useTranslations("chat");
  const chatHistory = useAppStore((s) => s.chatHistory);
  const setInputDraft = useAppStore((s) => s.setInputDraft);
  const isGenerating = useAppStore((s) => s.isGenerating);
  const activeAgent = useAppStore((s) => s.activeAgent);
  const activeSkills = useAppStore((s) => s.activeSkills);
  const researchProgress = useAppStore((s) => s.researchProgress);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 응답이 진행 중인데 아직 스트리밍 중인 assistant 메시지가 없으면(첫 토큰 전) "분석 중" 표시
  const last = chatHistory[chatHistory.length - 1];
  const showThinking =
    isGenerating && !(last?.role === "assistant" && last?.streaming);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory, showThinking]);

  if (chatHistory.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <Image
          src="/logo.png"
          alt="OpenMake"
          width={56}
          height={56}
          className="h-14 w-14 rounded-2xl object-contain"
        />
        <h2 className="mt-5 text-2xl font-bold text-fg">{t("emptyState.title")}</h2>
        <p className="mt-2 max-w-md text-sm text-muted">
          {t.rich("emptyState.description", {
            slash: (chunks) => <span className="font-mono text-accent">{chunks}</span>,
          })}
        </p>

        <div className="mt-7 grid w-full max-w-md grid-cols-2 gap-2.5">
          {QUICK_STARTS.map((q) => (
            <button
              key={q.labelKey}
              onClick={() => setInputDraft(t(q.promptKey))}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-3 text-left text-sm font-medium text-fg transition hover:border-border-strong hover:bg-surface-2"
            >
              <q.icon className="h-4 w-4 shrink-0 text-accent" />
              <span className="truncate">{t(q.labelKey)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      {chatHistory.map((m, i) =>
        m.role === "user" ? (
          <div key={i} className="flex justify-end">
            <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-accent-soft px-4 py-2.5 text-sm text-fg">
              {m.content}
            </div>
          </div>
        ) : m.role === "system" ? (
          <div key={i} className="flex justify-center">
            <div className="rounded-md bg-danger-soft px-3 py-1.5 text-xs text-danger">
              {m.content}
            </div>
          </div>
        ) : (
          <div key={i} className="flex gap-3">
            <Image src="/logo.png" alt="OpenMake" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-md object-contain" />
            <div className="min-w-0 flex-1">
              <p className="mb-1 text-xs font-medium text-muted">OpenMake</p>
              {m.reasoning && (
                <details className="group mb-2 rounded-lg border border-border bg-surface-2/60 text-xs">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-1.5 font-medium text-muted list-none [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-90" />
                    <Brain className="h-3.5 w-3.5 text-accent" />
                    {t("reasoningLabel")}
                  </summary>
                  <div className="whitespace-pre-wrap px-3 pb-2.5 pt-1 leading-relaxed text-muted">
                    {m.reasoning}
                  </div>
                </details>
              )}
              <div className="text-sm leading-relaxed text-fg">
                {m.agentTask ? (
                  <AgentTaskCard task={m.agentTask} approvals={m.approvals} taskId={m.taskId} />
                ) : m.structured ? (
                  <StructuredAnswer data={m.structured} />
                ) : (
                  <AssistantContent content={m.content} streaming={m.streaming} />
                )}
                {m.streaming && !m.agentTask && (
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-text-bottom" />
                )}
              </div>
              {m.id && !m.streaming && !m.agentTask && !m.structured && m.content.trim().length > 0 && (
                <FeedbackButtons messageId={m.id} />
              )}
            </div>
          </div>
        ),
      )}
      {researchProgress && <ResearchProgressBanner />}
      {showThinking && <ThinkingIndicator agent={activeAgent} skills={activeSkills} />}
      <div ref={bottomRef} className={cn("h-px")} />
    </div>
  );
}
