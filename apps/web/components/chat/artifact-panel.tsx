"use client";

import { useEffect, useState } from "react";
import { X, Code2, Eye, Copy, Check } from "lucide-react";
import { useAppStore } from "@/lib/store";
import type { Artifact } from "@/lib/store";
import { ApiClient } from "@/lib/api-client";
import { isIframeKind, buildArtifactSrcDoc } from "@/lib/artifact-render";
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
  if (kind === "code") {
    return (
      <div className="h-full overflow-auto px-3">
        <Markdown content={"```" + (lang ?? "") + "\n" + content + "\n```"} />
      </div>
    );
  }
  if (isIframeKind(kind)) {
    return <ArtifactFrame srcDoc={buildArtifactSrcDoc(kind, content)} title={artifact.title} />;
  }
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

  const canToggle = isIframeKind(active.kind) && !active.streaming;

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
