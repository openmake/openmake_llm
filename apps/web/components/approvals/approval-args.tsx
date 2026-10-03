/**
 * 승인 대상 인자 표시 — 요약과, 잘린 경우의 전문 펼쳐 보기.
 *
 * 승인함(`task-approvals.tsx`)과 채팅 인라인(`chat/message-list.tsx`)이 함께 쓴다. 요약만 보이면 긴 셸 명령의
 * 뒤쪽을 보지 못한 채 승인하게 되므로, 잘린 경우에는 반드시 전문을 펼쳐 볼 수 있게 한다.
 * 훅을 쓰지 않는 순수 표시 컴포넌트다(라벨은 호출부가 번역해 넘긴다).
 */
import { DiffView } from "@/components/chat/diff-view";

/** PURE: 인자 요약 — 질문·명령은 그 문자열을, 그 외는 JSON 을 보인다. maxChars 를 넘으면 잘라내고 full 에 전문을 싣는다. */
export function summarizeApprovalArgs(args: Record<string, unknown> | undefined, maxChars: number): { text: string; full?: string } {
  if (!args) return { text: "" };
  const raw =
    typeof args.question === "string"
      ? args.question
      : typeof args.command === "string"
        ? args.command
        : JSON.stringify(args, null, 2);
  return raw.length > maxChars ? { text: `${raw.slice(0, maxChars)}…`, full: raw } : { text: raw };
}

/** 잘린 인자의 전문 — full 이 없으면(잘리지 않음) 아무것도 그리지 않는다. */
export function ApprovalArgsFull({ full, label }: { full?: string; label: string }) {
  if (!full) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs text-accent">{label}</summary>
      <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 font-mono text-xs text-fg">{full}</pre>
    </details>
  );
}

/** 절차 본문을 미리보기로 싣는 도구 — 파일 변경(diff)이 아니라 실행될 절차다. */
const PROCEDURE_PREVIEW_TOOLS = new Set(["skill_run"]);

/** 실행 전 미리보기 — 파일 쓰기는 diff 뷰어로, 절차 본문(skill_run)은 본문 그대로 보인다. */
export function ApprovalPreview({ toolName, preview, diffLabel, procedureLabel, compact }: {
  toolName: string; preview?: string; diffLabel: string; procedureLabel: string; compact?: boolean;
}) {
  if (!preview) return null;
  const procedure = PROCEDURE_PREVIEW_TOOLS.has(toolName);
  return (
    <details className={compact ? "mt-1" : "mt-2"}>
      <summary className={compact ? "cursor-pointer text-[11px] text-accent" : "cursor-pointer text-xs text-accent"}>{procedure ? procedureLabel : diffLabel}</summary>
      {procedure
        ? <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface p-2 font-mono text-xs text-fg">{preview}</pre>
        : <div className="mt-1"><DiffView text={preview} /></div>}
    </details>
  );
}
