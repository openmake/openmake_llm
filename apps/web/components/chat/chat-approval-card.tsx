"use client";

/**
 * 채팅 도구 승인 카드(W3 S3) — 채팅 답변이 고위험·외부 도구를 부르기 전에 서버가 기다리는 승인을
 * 스트리밍 답변 아래에서 결정한다. 대기는 ws `chat_approval_pending`, 결정 결과는 `chat_approval_decided`
 * (use-chat-socket 이 store 의 pendingChatApprovals 를 채우고 비운다). 결정은 REST 로 보낸다.
 * 남은 시간이 0 이 되면 서버가 거절(timeout)로 끝내므로 버튼을 거두고 거절 문구를 보인다(decided 가 오면 카드가 빠진다).
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Clock, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { ApprovalArgsFull, summarizeApprovalArgs } from "@/components/approvals/approval-args";
import { ApiClient } from "@/lib/api-client";
import { useAppStore, type PendingChatApproval } from "@/lib/store";
import { REJECT_REASON_MAX_CHARS } from "@/lib/constants/ui-limits";

/** 남은 시간 표시를 다시 그리는 주기(ms). */
const COUNTDOWN_TICK_MS = 1000;
/** 인자 요약 길이 — 넘으면 전문 펼쳐 보기가 붙는다(에이전트 작업 인라인 승인과 같은 값). */
const ARGS_SUMMARY_MAX_CHARS = 90;
const MS_PER_SECOND = 1000;

/** 실행·삭제는 경고 톤 — 승인함(task-approvals)의 위험 배지와 같은 기준. */
function riskTone(riskClass: PendingChatApproval["riskClass"]): "warn" | "neutral" {
  return riskClass === "exec" || riskClass === "destructive" ? "warn" : "neutral";
}

/** 대기 중인 승인이 있는 동안만 1초마다 현재 시각을 갱신한다. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function ChatApprovalCards() {
  const t = useTranslations("chatApproval");
  const tChat = useTranslations("chat");
  const tApprovals = useTranslations("approvals");
  const approvals = useAppStore((s) => s.pendingChatApprovals);
  // 결정을 보낸(또는 보내는 중인) 승인 — decided 이벤트로 카드가 빠질 때까지 버튼을 막는다.
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const now = useNow(approvals.length > 0);
  if (approvals.length === 0) return null;

  async function decide(a: PendingChatApproval, decision: "approve" | "reject") {
    setInFlight((prev) => ({ ...prev, [a.approvalId]: true }));
    const reason = decision === "reject" ? (rejectReasons[a.approvalId] ?? "").trim() : "";
    try {
      // id 에 콜론이 들어간다(apv_chat:<chatId>_<n>) — 경로 조각으로 인코딩한다.
      await ApiClient.post(`/api/chat/approvals/${encodeURIComponent(a.approvalId)}/${decision}`, reason ? { reason } : {});
    } catch (e) {
      setInFlight((prev) => ({ ...prev, [a.approvalId]: false }));
      alert(tChat("approvals.processFailed", { error: e instanceof Error ? e.message : tChat("approvals.errorFallback") }));
    }
  }

  return (
    <div className="mt-1 space-y-2 rounded-md border border-warning-soft bg-warning-soft/50 p-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
        <ShieldCheck className="h-3.5 w-3.5 text-warning" /> {t("title")}
      </p>
      {approvals.map((a) => {
        const summary = summarizeApprovalArgs(a.args, ARGS_SUMMARY_MAX_CHARS, a.toolName);
        const seconds = Math.max(0, Math.ceil((a.expiresAt - now) / MS_PER_SECOND));
        const expired = seconds === 0;
        const disabled = expired || !!inFlight[a.approvalId];
        return (
          <div key={a.approvalId} className="space-y-1.5 rounded-md border border-border bg-surface-1 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-mono text-xs text-fg-2">{a.toolName}</span>
                <Badge tone={riskTone(a.riskClass)} className="ml-2 px-2 py-0 text-[11px]">{tApprovals(`tasks.risk.${a.riskClass}`)}</Badge>
                <span className="ml-2 break-all text-xs text-muted">{summary.text}</span>
                <ApprovalArgsFull full={summary.full} label={tChat("approvals.fullArgs", { chars: summary.full?.length ?? 0 })} />
              </div>
              {!expired && (
                <div className="flex shrink-0 gap-1">
                  <button
                    disabled={disabled}
                    onClick={() => void decide(a, "reject")}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-2 disabled:opacity-50"
                  >{t("reject")}</button>
                  <button
                    disabled={disabled}
                    onClick={() => void decide(a, "approve")}
                    className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
                  >{t("approve")}</button>
                </div>
              )}
            </div>
            {expired ? (
              <p className="text-[11px] text-danger">{t("denied")}</p>
            ) : (
              <>
                <p className="flex items-center gap-1 text-[11px] text-muted">
                  <Clock className="h-3 w-3" aria-hidden /> {t("waiting")} · {t("expiresIn", { seconds })}
                </p>
                <input
                  value={rejectReasons[a.approvalId] ?? ""}
                  onChange={(e) => setRejectReasons((prev) => ({ ...prev, [a.approvalId]: e.target.value }))}
                  placeholder={tApprovals("tasks.rejectReasonPlaceholder")}
                  aria-label={tApprovals("tasks.rejectReasonPlaceholder")}
                  maxLength={REJECT_REASON_MAX_CHARS}
                  disabled={disabled}
                  className="w-full rounded-md border border-border bg-surface-2 px-1.5 py-1 text-xs text-fg-1 outline-none focus:border-accent disabled:opacity-50"
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
