"use client";

import { useEffect, useState } from "react";
import { X, Code2, Eye, Copy, Check, Play, Loader2 } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { Artifact } from "@/lib/store";
import { ApiClient, ApiError } from "@/lib/api-client";
import { buildArtifactSrcDoc, previewKindFor } from "@/lib/artifact-render";
import { ArtifactFrame } from "./artifact-frame";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";

/** 영속 아티팩트 행(REST) → store Artifact 매핑. */
interface PersistedArtifact {
  artifact_id: string;
  kind: string;
  title: string | null;
  language: string | null;
  content: string;
}

/** 컨테이너 실행 결과(POST /api/artifacts/execute). */
interface ExecResult {
  runtime: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
}

/** 서버 실행 가능 언어 (백엔드 ARTIFACT_EXEC_RUNTIMES 와 정합). */
const RUNNABLE_LANGS = new Set(["python", "py", "python3", "javascript", "js", "node", "nodejs"]);

function CodeArtifactView({ artifact }: { artifact: Artifact }) {
  const lang = (artifact.lang ?? "").toLowerCase().trim();
  const runnable = RUNNABLE_LANGS.has(lang);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await ApiClient.post<{ data: ExecResult }>("/api/artifacts/execute", {
        lang,
        code: artifact.content,
      });
      setResult(res.data);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 503) setError("코드 실행 기능이 비활성화되어 있습니다.");
        else if (e.status === 429) setError("실행 요청이 너무 많습니다. 잠시 후 다시 시도하세요.");
        else if (e.status === 400) setError("지원하지 않는 언어입니다.");
        else if (e.status === 413) setError("코드가 너무 큽니다.");
        else setError(e.message);
      } else {
        setError("실행에 실패했습니다.");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {runnable && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition hover:bg-accent-hover disabled:opacity-60"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {running ? "실행 중…" : "실행"}
          </button>
          <span className="text-[11px] text-faint">샌드박스(네트워크 차단) · {lang}</span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto px-3">
        <Markdown content={"```" + (lang || "") + "\n" + artifact.content + "\n```"} />
        {error && (
          <div className="mb-3 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </div>
        )}
        {result && (
          <div className="mb-3 rounded-md border border-border bg-surface-2">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted">
              <span>출력</span>
              <span className="font-mono">exit={result.exitCode ?? "—"}</span>
              <span className="font-mono">{result.durationMs}ms</span>
              {result.timedOut && <span className="text-danger">시간 초과</span>}
              {result.truncated && <span className="text-faint">잘림</span>}
            </div>
            {result.stdout && (
              <pre className="overflow-x-auto px-3 py-2 text-xs text-fg-2">{result.stdout}</pre>
            )}
            {result.stderr && (
              <pre className="overflow-x-auto border-t border-border px-3 py-2 text-xs text-danger">
                {result.stderr}
              </pre>
            )}
            {!result.stdout && !result.stderr && (
              <p className="px-3 py-2 text-xs text-faint">(출력 없음)</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CsvTable({ content }: { content: string }) {
  const rows = content
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(","));
  if (rows.length === 0) return null;
  const [head, ...body] = rows;
  return (
    <div className="overflow-auto p-3">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border border-border bg-surface-2 px-2.5 py-1.5 text-left font-medium text-fg">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="border border-border px-2.5 py-1.5 text-fg-2">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ArtifactBody({ artifact, view }: { artifact: Artifact; view: "preview" | "code" }) {
  const { kind, lang, content, streaming } = artifact;

  // 스트리밍 중이거나 코드 뷰 선택 시 → 원본 표시
  if (view === "code" || streaming) {
    return (
      <div className="h-full overflow-auto px-3">
        <Markdown content={"```" + (lang ?? kind) + "\n" + content + "\n```"} />
      </div>
    );
  }
  if (kind === "markdown") {
    return (
      <div className="h-full overflow-auto p-4">
        <Markdown content={content} />
      </div>
    );
  }
  if (kind === "csv") return <CsvTable content={content} />;
  // 미리보기 가능(html/svg/mermaid/chart/react) — kind=code+웹 lang(예: ```html 펜스) 포함
  const previewKind = previewKindFor(kind, lang);
  if (previewKind) {
    return <ArtifactFrame srcDoc={buildArtifactSrcDoc(previewKind, content)} title={artifact.title} />;
  }
  if (kind === "code") return <CodeArtifactView artifact={artifact} />;
  // 미지원 kind → 코드 폴백
  return (
    <div className="h-full overflow-auto px-3">
      <Markdown content={"```\n" + content + "\n```"} />
    </div>
  );
}

export function ArtifactPanel() {
  const artifacts = useAppStore((s) => s.artifacts);
  const activeArtifactId = useAppStore((s) => s.activeArtifactId);
  const open = useAppStore((s) => s.artifactPanelOpen);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const setArtifactPanelOpen = useAppStore((s) => s.setArtifactPanelOpen);
  const setArtifacts = useAppStore((s) => s.setArtifacts);

  const [view, setView] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);

  // 세션 진입 시 영속 아티팩트 복원 (메모리에 없을 때만 — 라이브 스트림 보호)
  useEffect(() => {
    if (!currentSessionId) return;
    if (useAppStore.getState().artifacts.length > 0) return;
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<{ data?: { artifacts?: PersistedArtifact[] } }>(
          `/api/sessions/${currentSessionId}/artifacts`,
        );
        if (!alive) return;
        const rows = res.data?.artifacts ?? [];
        if (rows.length > 0) {
          setArtifacts(
            rows.map((r) => ({
              id: r.artifact_id,
              kind: r.kind,
              title: r.title ?? r.artifact_id,
              lang: r.language,
              content: r.content,
              streaming: false,
            })),
          );
        }
      } catch {
        /* 미인증/없음 → 무시 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [currentSessionId, setArtifacts]);

  const active = artifacts.find((a) => a.id === activeArtifactId) ?? artifacts[artifacts.length - 1];

  if (!open || !active) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(active.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 불가 무시 */
    }
  };

  const canToggle = previewKindFor(active.kind, active.lang) !== null && !active.streaming;

  return (
    <aside className="fixed inset-0 z-40 flex w-full flex-col border-border bg-surface lg:static lg:inset-auto lg:z-auto lg:w-[44%] lg:max-w-[560px] lg:border-l">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {active.kind}
          {active.lang ? `·${active.lang}` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{active.title}</span>
        {active.streaming && <span className="text-[11px] text-faint">생성 중…</span>}
        {canToggle && (
          <button
            type="button"
            onClick={() => setView((v) => (v === "preview" ? "code" : "preview"))}
            aria-label={view === "preview" ? "코드 보기" : "미리보기"}
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
          >
            {view === "preview" ? <Code2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label="복사"
          className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setArtifactPanelOpen(false)}
          aria-label="패널 닫기"
          className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {artifacts.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
          {artifacts.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveArtifact(a.id)}
              className={cn(
                "shrink-0 truncate rounded px-2 py-1 text-xs transition",
                a.id === active.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-surface-3 hover:text-fg",
              )}
            >
              {a.title}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <ArtifactBody artifact={active} view={canToggle ? view : "preview"} />
      </div>
    </aside>
  );
}
