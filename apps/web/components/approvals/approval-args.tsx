/**
 * 승인 대상 인자 표시 — 요약과, 잘린 경우의 전문 펼쳐 보기.
 *
 * 승인함(`task-approvals.tsx`)과 채팅 인라인(`chat/message-list.tsx`)이 함께 쓴다. 요약만 보이면 긴 셸 명령의
 * 뒤쪽을 보지 못한 채 승인하게 되므로, 잘린 경우에는 반드시 전문을 펼쳐 볼 수 있게 한다.
 * 훅을 쓰지 않는 순수 표시 컴포넌트다(라벨은 호출부가 번역해 넘긴다).
 */
import { DiffView } from "@/components/chat/diff-view";

/** 사용자 메모리에 쓰는 도구 — 저장할 문장을 자르지 않고 그대로 보인다(사용자가 문장을 읽고 승인한다). */
const MEMORY_SAVE_TOOL = "memory_save";

/** PURE: 이 승인이 사용자 메모리 쓰기인가. */
export function isMemorySaveApproval(toolName: string | undefined): boolean {
  return toolName === MEMORY_SAVE_TOOL;
}

/**
 * PURE: 인자 요약 — 질문·명령은 그 문자열을, 그 외는 JSON 을 보인다. maxChars 를 넘으면 잘라내고 full 에 전문을 싣는다.
 * 메모리 저장(toolName 이 memory_save)은 저장할 문장 전문을 자르지 않고 보인다.
 */
export function summarizeApprovalArgs(args: Record<string, unknown> | undefined, maxChars: number, toolName?: string): { text: string; full?: string } {
  if (!args) return { text: "" };
  if (isMemorySaveApproval(toolName) && typeof args.content === "string") return { text: args.content };
  const raw =
    typeof args.question === "string"
      ? args.question
      : typeof args.command === "string"
        ? args.command
        : JSON.stringify(args, null, 2);
  return raw.length > maxChars ? { text: `${raw.slice(0, maxChars)}…`, full: raw } : { text: raw };
}

/**
 * PURE: 허용 목록 밖 사이트에 보내는 쓰기 — 서버가 승인 인자에 실어 준 `offListWrites` 를 "사이트: 내용" 줄로 바꾼다.
 * 자동 승인·건너뜀에서도 묻는 이유가 이것이라, JSON 앞부분에 가려지지 않게 카드 맨 위에 따로 보인다.
 */
export function siteWriteLines(args: Record<string, unknown> | undefined): string[] {
  const list = args?.offListWrites;
  if (!Array.isArray(list)) return [];
  return list.flatMap((w) => {
    const { host, detail } = (w ?? {}) as { host?: unknown; detail?: unknown };
    return typeof host === "string" && host ? [typeof detail === "string" && detail ? `${host}: ${detail}` : host] : [];
  });
}

/**
 * PURE: PC 파일 업로드 — 서버가 승인 인자에 실어 준 `siteUploads` 를 "사이트: 파일, 파일" 줄로 바꾼다(2026-10-06).
 * 업로드는 허용 목록과 무관하게 매번 묻는다 — 어느 사이트에 어떤 파일이 나가는지를 카드 맨 위에 보인다.
 */
export function siteUploadLines(args: Record<string, unknown> | undefined): string[] {
  const list = args?.siteUploads;
  if (!Array.isArray(list)) return [];
  return list.flatMap((u) => {
    const { host, files } = (u ?? {}) as { host?: unknown; files?: unknown };
    const names = Array.isArray(files) ? files.filter((f): f is string => typeof f === "string") : [];
    return [`${typeof host === "string" && host ? host : "?"}: ${names.join(", ")}`];
  });
}

/** 업로드 안내 — 줄이 없으면 아무것도 그리지 않는다. */
export function ApprovalSiteUploads({ args, label }: { args?: Record<string, unknown>; label: string }) {
  const lines = siteUploadLines(args);
  if (lines.length === 0) return null;
  return (
    <div className="mb-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-xs text-fg">
      <p className="font-medium">{label}</p>
      {lines.map((l, i) => <p key={i} className="break-all font-mono text-[11px]">{l}</p>)}
    </div>
  );
}

/** 사이트 쓰기 안내 — 줄이 없으면 아무것도 그리지 않는다. */
export function ApprovalSiteWrites({ args, label }: { args?: Record<string, unknown>; label: string }) {
  const lines = siteWriteLines(args);
  if (lines.length === 0) return null;
  return (
    <div className="mb-1 rounded-md border border-warning/40 bg-warning-soft px-2 py-1 text-xs text-fg">
      <p className="font-medium">{label}</p>
      {lines.map((l, i) => <p key={i} className="break-all font-mono text-[11px]">{l}</p>)}
    </div>
  );
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
