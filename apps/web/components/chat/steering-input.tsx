"use client";

/**
 * 실행 중 중간 지시(steering) 입력 — 실행 중/일시정지 task 에 방향 지시를 보낸다.
 * 백엔드 POST /api/agent-tasks/:taskId/steer 로 전송, 다음 턴 경계에서 반영된다.
 * 채팅 인라인 카드와 agent-tasks 상세 양쪽에서 공유한다.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { ApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function SteeringInput({ taskId }: { taskId?: string }) {
  const t = useTranslations("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function send() {
    const message = text.trim();
    if (!message || !taskId || busy) return;
    setBusy(true);
    try {
      await ApiClient.post(`/api/agent-tasks/${taskId}/steer`, { message });
      setText("");
      setSent(true);
      setTimeout(() => setSent(false), 2500);
    } catch (e) {
      alert(t("steering.failed", { error: e instanceof Error ? e.message : "error" }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1 rounded-md border border-border bg-surface-2/50 p-2">
      <p className="mb-1 text-[11px] font-medium text-muted">{t("steering.label")}</p>
      <div className="flex items-end gap-1.5">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
          }}
          placeholder={t("steering.placeholder")}
          rows={2}
          disabled={busy}
          maxLength={2000}
          className="min-w-0 flex-1 resize-y rounded-md border border-border bg-surface-1 p-1.5 text-xs text-fg-1 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => void send()}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium disabled:opacity-50",
            sent ? "bg-success-soft text-success" : "bg-accent text-accent-fg hover:opacity-90",
          )}
        >
          {sent ? t("steering.sent") : <Send className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
