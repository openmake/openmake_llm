"use client";

/**
 * 에이전트 작업 승인 대기(HITL) — 고위험 도구 호출 · `ask_human` 질문 · 외부 MCP 서버 입력 요청(`mcp_elicit`).
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
import { ApprovalArgsFull, ApprovalPreview, ApprovalSiteWrites, isMemorySaveApproval, summarizeApprovalArgs } from "./approval-args";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Check, X, Loader2, MessageCircleQuestion, Wrench, ExternalLink } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { isQuestionApproval, elicitationHint, structuredQuestions } from "@/lib/hitl-question";
import { QuestionChoices } from "./question-choices";
import { onAgentTaskChange } from "@/lib/agent-task-change";
import { REJECT_REASON_MAX_CHARS } from "@/lib/constants/ui-limits";
import { shouldSubmitOnEnter } from "@/lib/approval-input";

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
  /** 소유자·현재 담당자(138) — 담당자가 있으면 이관된 항목 */
  userId?: string;
  assigneeUserId?: string;
}

interface OrgMember { user_id: string; role: string }

const ARGS_SUMMARY_MAX_CHARS = 300;

export function TaskApprovals({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("approvals");
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // 거절 사유(선택) — 적으면 에이전트에 그대로 전달된다.
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  // 최근 결정(138) — 프로세스가 내려간 사이 내린 승인은 아직 실행되지 않았으므로 철회할 수 있다.
  const [recent, setRecent] = useState<RecentDecision[]>([]);
  // 이관 대상(138) — 활성 조직 멤버. 조직이 없으면 이관 UI 를 숨긴다.
  const activeOrgId = useAppStore((s) => s.auth.currentUser?.activeOrgId ?? null);
  const myId = useAppStore((s) => s.auth.currentUser?.id);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [reassignTo, setReassignTo] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!activeOrgId) { setMembers([]); return; }
    ApiClient.get<{ data: { members: OrgMember[] } }>(`/api/organizations/${activeOrgId}/members`)
      .then((r) => setMembers((r?.data?.members ?? []).filter((m) => m.user_id !== myId)))
      .catch(() => setMembers([]));
  }, [activeOrgId, myId]);

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

  // 다른 사람이 이관·에스컬레이션했거나 철회된 승인 — 목록을 즉시 다시 읽는다.
  useEffect(() => onAgentTaskChange((c) => { if (c.reason !== "plan_edited") void load(); }), [load]);

  const sendAnswer = (id: string) =>
    void run(id, () => ApiClient.post(`/api/agent-tasks/approvals/${id}/answer`, { text: answers[id] ?? "" }));

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
        const isQuestion = isQuestionApproval(a.toolName);
        const elicit = elicitationHint(a.toolName, a.args);
        const structured = structuredQuestions(a.toolName, a.args);
        const summary = summarizeApprovalArgs(a.args, ARGS_SUMMARY_MAX_CHARS, a.toolName);
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
                  {isMemorySaveApproval(a.toolName) ? t("tasks.risk.memory") : t(`tasks.risk.${a.riskClass}`)}
                  {a.sensitive ? ` · ${t("tasks.risk.sensitive")}` : ""}
                </Badge>
              )}
              {a.assigneeUserId && a.assigneeUserId !== a.userId && (
                <Badge tone="neutral">{a.assigneeUserId === myId ? t("tasks.assignedToMe") : t("tasks.assignedAway")}</Badge>
              )}
              <Link
                href={`/agent-tasks?task=${encodeURIComponent(a.taskId)}`}
                className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              >
                {t("tasks.openTask")}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            {/* 구조화 질문 — 선택지를 버튼으로. 고르면 아래 답변 입력란이 채워진다(고쳐 쓸 수 있다). */}
            {structured ? (
              <QuestionChoices intro={structured.intro} questions={structured.questions} disabled={acting} recommendedLabel={t("tasks.recommended")}
                onAnswerAction={(text) => setAnswers((p) => ({ ...p, [a.approvalId]: text }))} />
            ) : (
              <>
                <ApprovalSiteWrites args={a.args} label={t("tasks.siteWrites")} />
                <p className="whitespace-pre-wrap break-words text-sm text-fg">{summary.text}</p>
                <ApprovalArgsFull full={summary.full} label={t("tasks.fullArgs", { chars: summary.full?.length ?? 0 })} />
              </>
            )}
            {elicit && (
              <p className="mt-1 text-xs text-muted">
                {t("tasks.elicitHint", { server: elicit.server, fields: elicit.fields || "-" })}
                {elicit.jsonExample && <> · {t("tasks.elicitJsonHint", { example: elicit.jsonExample })}</>}
              </p>
            )}
            <ApprovalPreview toolName={a.toolName} preview={a.preview} diffLabel={t("tasks.preview")} procedureLabel={t("tasks.procedurePreview")} />

            {isQuestion && (
              <input
                value={answers[a.approvalId] ?? ""}
                onChange={(e) => setAnswers((p) => ({ ...p, [a.approvalId]: e.target.value }))}
                onKeyDown={(e) => {
                  if (!shouldSubmitOnEnter({ key: e.key, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode })) return;
                  e.preventDefault();
                  if (!acting && (answers[a.approvalId] ?? "").trim()) sendAnswer(a.approvalId);
                }}
                placeholder={t("tasks.answerPlaceholder")}
                className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            )}

            {!isQuestion && (
              <input
                value={rejectReasons[a.approvalId] ?? ""}
                onChange={(e) => setRejectReasons((p) => ({ ...p, [a.approvalId]: e.target.value }))}
                placeholder={t("tasks.rejectReasonPlaceholder")}
                aria-label={t("tasks.rejectReasonPlaceholder")}
                maxLength={REJECT_REASON_MAX_CHARS}
                className="mt-3 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent"
              />
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {isQuestion && (
                <Button
                  size="sm"
                  disabled={acting || !(answers[a.approvalId] ?? "").trim()}
                  onClick={() => sendAnswer(a.approvalId)}
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
              {/* 이 작업 자동 승인 — 이후 도구 호출은 승인 없이 진행(질문형 승인 제외).
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
                    ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/reject`,
                      !isQuestion && (rejectReasons[a.approvalId] ?? "").trim() ? { reason: rejectReasons[a.approvalId].trim() } : {}),
                  )
                }
              >
                <X className="h-3.5 w-3.5" />
                {t("tasks.reject")}
              </Button>
              {activeOrgId && (
                <>
                  <select
                    aria-label={t("tasks.reassign")}
                    value={reassignTo[a.approvalId] ?? ""}
                    onChange={(e) => setReassignTo((p) => ({ ...p, [a.approvalId]: e.target.value }))}
                    className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg"
                  >
                    <option value="">{t("tasks.reassignPick")}</option>
                    {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.user_id} · {m.role}</option>)}
                  </select>
                  <Button size="sm" variant="outline" disabled={acting || !reassignTo[a.approvalId]}
                    onClick={() => void run(a.approvalId, () => ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/reassign`, { toUserId: reassignTo[a.approvalId] }))}>
                    {t("tasks.reassign")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={acting} title={t("tasks.escalateHint")}
                    onClick={() => void run(a.approvalId, () => ApiClient.post(`/api/agent-tasks/approvals/${a.approvalId}/escalate`, {}))}>
                    {t("tasks.escalate")}
                  </Button>
                </>
              )}
            </div>
          </Card>
        );
      })}
      {recentSection}
    </div>
  );
}
