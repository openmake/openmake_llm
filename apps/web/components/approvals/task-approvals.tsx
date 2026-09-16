"use client";

/**
 * 에이전트 작업 승인 대기(HITL) — 고위험 도구 호출 · `ask_human` 질문.
 *
 * 채팅 인라인(`chat/message-list.tsx` InlineApprovals)에도 같은 승인 UI 가 있다. 그쪽은
 * 대화 흐름 안에서 즉시 답하는 용도라 그대로 두고, 여기서는 **작업을 떠나 있어도**
 * 대기 중인 승인을 찾을 수 있게 한다 — 승인 창구를 `/approvals` 한 곳으로 모으는 목적.
 *
 * ⚠️ 이 목록은 **인메모리 레지스트리**(`task-sandbox/approval-gate.ts`)라 서버 재시작 시
 * 사라진다. 없어진 항목에 응답하면 404 가 나므로 실패 시 목록을 다시 읽는다.
 *
 * @see app/(workspace)/approvals/page.tsx
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Check, X, Loader2, MessageCircleQuestion, Wrench, ExternalLink } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { DiffView } from "@/components/chat/diff-view";

interface RecentDecision {
  approvalId: string;
  taskId: string;
  toolName: string;
  status: "approved" | "revoked";
  decidedAt: string | null;
  consumedAt: string | null;
  revocable: boolean;
}

interface PendingItem {
  approvalId: string;
  taskId: string;
  toolName: string;
  args?: Record<string, unknown>;
  /** 위험 등급(백엔드 config/tool-policy) — 승인이 필요한 이유 표시. 구 서버는 미전송. */
  riskClass?: "read" | "write" | "destructive" | "exec" | "network" | "external" | "control";
  /** 자격증명 파일을 바꾸는 호출. */
  sensitive?: boolean;
  /** 실행 전 미리보기(unified diff, 138) — 파일 쓰기 도구만 */
  preview?: string;
}

/** 인자 요약 — 어떤 작업을 승인하는지 한 줄로 보인다(장문은 잘라낸다). */
function summarizeArgs(args?: Record<string, unknown>): string {
  if (!args) return "";
  const raw =
    typeof args.question === "string"
      ? args.question
      : typeof args.command === "string"
        ? args.command
        : JSON.stringify(args);
  return raw.length > 300 ? `${raw.slice(0, 300)}…` : raw;
}

export function TaskApprovals({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("approvals");
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 최근 결정(138) — 프로세스가 내려간 사이 내린 승인은 아직 실행되지 않았으므로 철회할 수 있다.
  const [recent, setRecent] = useState<RecentDecision[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<{ data: { pending: PendingItem[] } }>(
        "/api/agent-tasks/approvals/pending",
      );
      setItems(res?.data?.pending ?? []);
      const rec = await ApiClient.get<{ data: { decisions: RecentDecision[] } }>("/api/agent-tasks/approvals/recent?minutes=30").catch(() => null);
      setRecent(rec?.data?.decisions ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
    } catch (err) {
      alert(t("tasks.actionFailed", { error: err instanceof Error ? err.message : "" }));
    } finally {
      setBusy(null);
      await load(); // 성공/실패(만료 404) 모두 서버 상태로 재동기화
      onRefreshAction?.();
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const recentSection = recent.length > 0 && (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium text-muted">{t("tasks.recentTitle")}</p>
      <div className="space-y-1">
        {recent.map((d) => (
          <div key={d.approvalId} className="flex items-center justify-between gap-2 rounded-md border border-line bg-bg-1 px-3 py-2 text-xs">
            <span className="min-w-0 truncate">
              <span className="font-mono">{d.toolName}</span> · {d.status === "revoked" ? t("tasks.revoked") : d.consumedAt ? t("tasks.consumed") : t("tasks.approvedPending")}
              {d.decidedAt ? ` · ${new Date(d.decidedAt).toLocaleTimeString()}` : ""}
            </span>
            <div className="flex shrink-0 gap-1">
              {d.revocable && (
                <Button size="sm" variant="outline" disabled={busy === d.approvalId} title={t("tasks.revokeHint")}
                  onClick={() => void run(d.approvalId, () => ApiClient.post(`/api/agent-tasks/approvals/${d.approvalId}/revoke`, {}))}>
                  {t("tasks.revoke")}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy === d.approvalId} title={t("tasks.autoApproveOffHint")}
                onClick={() => void run(d.approvalId, () => ApiClient.post(`/api/agent-tasks/${d.taskId}/approvals/auto-approve`, { enabled: false }))}>
                {t("tasks.autoApproveOff")}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (items.length === 0) {
    return (
      <>
        <p className="py-6 text-center text-sm text-muted">{t("tasks.empty")}</p>
        {recentSection}
      </>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((a) => {
        const isQuestion = a.toolName === "ask_human";
        const acting = busy === a.approvalId;
        return (
          <Card key={a.approvalId} className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={isQuestion ? "accent" : "warn"}>
                {isQuestion ? t("tasks.question") : t("tasks.tool")}
              </Badge>
              <span className="inline-flex items-center gap-1 font-mono text-xs text-muted">
                {isQuestion ? (
                  <MessageCircleQuestion className="h-3.5 w-3.5" />
                ) : (
                  <Wrench className="h-3.5 w-3.5" />
                )}
                {a.toolName}
              </span>
              {!isQuestion && a.riskClass && (
                <Badge tone={a.riskClass === "exec" || a.riskClass === "destructive" || a.sensitive ? "warn" : "neutral"}>
                  {t(`tasks.risk.${a.riskClass}`)}
                  {a.sensitive ? ` · ${t("tasks.risk.sensitive")}` : ""}
                </Badge>
              )}
              <Link
                href={`/agent-tasks?task=${encodeURIComponent(a.taskId)}`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {t("tasks.openTask")}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            <p className="whitespace-pre-wrap break-words text-sm text-fg">{summarizeArgs(a.args)}</p>
            {a.preview && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-accent">{t("tasks.preview")}</summary>
                <div className="mt-1"><DiffView text={a.preview} /></div>
              </details>
            )}

            {isQuestion && (
              <input
                value={answers[a.approvalId] ?? ""}
                onChange={(e) => setAnswers((p) => ({ ...p, [a.approvalId]: e.target.value }))}
                placeholder={t("tasks.answerPlaceholder")}
                className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {isQuestion && (
                <Button
                  size="sm"
                  disabled={acting || !(answers[a.approvalId] ?? "").trim()}
                  onClick={() =>
                    void run(a.approvalId, () =>
                      ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/answer`, {
                        text: answers[a.approvalId] ?? "",
                      }),
                    )
                  }
                >
                  {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("tasks.sendAnswer")}
                </Button>
              )}
              {!isQuestion && (
                <Button
                  size="sm"
                  disabled={acting}
                  onClick={() =>
                    void run(a.approvalId, () =>
                      ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/approve`, {}),
                    )
                  }
                >
                  {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("approve")}
                </Button>
              )}
              {/* 이 작업 자동 승인 — 이후 도구 호출은 승인 없이 진행(ask_human 제외).
                  구 /agent-tasks 인라인 패널에만 있던 기능을 단일 창구로 옮겨 온 것 */}
              {!isQuestion && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  title={t("tasks.autoApproveHint")}
                  onClick={() =>
                    void run(a.approvalId, () =>
                      ApiClient.post(`/api/agent-tasks/${a.taskId}/approvals/auto-approve`, {}),
                    )
                  }
                >
                  {t("tasks.autoApprove")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={acting}
                onClick={() =>
                  void run(a.approvalId, () =>
                    ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/reject`, {}),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
                {t("reject")}
              </Button>
            </div>
          </Card>
        );
      })}
      {recentSection}
    </div>
  );
}
