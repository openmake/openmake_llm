"use client";

/**
 * git diff 뷰어 — 통합 diff 를 파일별로 그룹핑해 접기/펼치기 + 파일별 +/− 통계 + 총합 요약으로
 * 렌더한다. agent-task 코드 작업(openmake_code)의 step_type='diff' 스텝 표시에 사용.
 * parseUnifiedDiff 는 순수 함수(파일 경계 `diff --git` 기준 분할 + 라인 카운트).
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, ChevronDown, Copy, Check, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DiffFile {
  path: string;
  additions: number;
  deletions: number;
  /** 파일 헤더(diff/index/---/+++)를 제외한 본문 라인(@@ 헝크 헤더 + 내용). */
  body: string[];
}

/** 통합 git diff 를 파일 단위로 파싱. `diff --git a/x b/x` 경계로 분할하고 +/− 라인을 센다. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  const isMeta = (l: string) =>
    l.startsWith("diff --git ") || l.startsWith("index ") ||
    l.startsWith("--- ") || l.startsWith("+++ ") ||
    l.startsWith("new file mode ") || l.startsWith("deleted file mode ") ||
    l.startsWith("similarity index ") || l.startsWith("rename ");
  const push = () => { if (cur) files.push(cur); };

  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      push();
      const m = line.match(/ b\/(.+)$/);
      cur = { path: m ? m[1] : line.slice("diff --git ".length), additions: 0, deletions: 0, body: [] };
      continue;
    }
    if (!cur) {
      // 'diff --git' 헤더 없이 시작하는 diff(단일 파일 등) — 합성 버킷.
      cur = { path: "", additions: 0, deletions: 0, body: [] };
    }
    if (line.startsWith("+") && !line.startsWith("+++")) cur.additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) cur.deletions++;
    if (!isMeta(line)) cur.body.push(line);
  }
  push();
  return files.filter((f) => f.body.length > 0 || f.additions > 0 || f.deletions > 0);
}

function lineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "bg-success-soft text-success";
  if (line.startsWith("-") && !line.startsWith("---")) return "bg-danger-soft text-danger";
  if (line.startsWith("@@")) return "text-accent";
  return "text-muted";
}

function FileSection({ file, defaultOpen }: { file: DiffFile; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="overflow-hidden rounded border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 bg-surface-2 px-2 py-1 text-left hover:bg-surface-3"
      >
        <Chevron className="h-3.5 w-3.5 shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-2">{file.path || "diff"}</span>
        <span className="shrink-0 font-mono text-[11px] text-success">+{file.additions}</span>
        <span className="shrink-0 font-mono text-[11px] text-danger">−{file.deletions}</span>
      </button>
      {open && (
        <pre className="max-h-80 overflow-auto bg-surface-1 px-2 py-1 font-mono text-xs leading-relaxed">
          {file.body.map((line, i) => (
            <div key={i} className={cn("whitespace-pre-wrap break-words", lineClass(line))}>
              {line || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export function DiffView({ text }: { text: string }) {
  const t = useTranslations("chat");
  const [copied, setCopied] = useState(false);
  const files = parseUnifiedDiff(text);
  if (files.length === 0) return null;
  const additions = files.reduce((s, f) => s + f.additions, 0);
  const deletions = files.reduce((s, f) => s + f.deletions, 0);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard 미허용 환경 — 무시 */ }
  };
  const download = () => {
    // 사용자가 자신의 repo 에 `git apply changes.patch` 로 적용할 수 있는 표준 패치.
    const url = URL.createObjectURL(new Blob([text], { type: "text/x-patch" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "changes.patch";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-1 space-y-1">
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-muted">{t("diff.files", { count: files.length })}</span>
        <span className="font-mono text-success">+{additions}</span>
        <span className="font-mono text-danger">−{deletions}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button" onClick={copy} title={t("diff.copy")}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted hover:bg-surface-2"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
            {copied ? t("diff.copied") : t("diff.copy")}
          </button>
          <button
            type="button" onClick={download} title={t("diff.download")}
            className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-muted hover:bg-surface-2"
          >
            <Download className="h-3 w-3" /> .patch
          </button>
        </div>
      </div>
      <div className="space-y-1">
        {files.map((f, i) => (
          <FileSection key={i} file={f} defaultOpen={files.length === 1} />
        ))}
      </div>
    </div>
  );
}
