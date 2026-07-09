"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Code2, Eye, Copy, Check, Play, Loader2, Download, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAppStore } from "@/lib/store";
import type { Artifact } from "@/lib/store";
import { ApiClient, ApiError } from "@/lib/api-client";
import type { ApiSuccess } from "@openmake/shared-types";
import { buildArtifactSrcDoc, previewKindFor } from "@/lib/artifact-render";
import { appendAnonSessionId } from "@/lib/anon-session";
import { ArtifactFrame } from "./artifact-frame";
import { ArtifactShareModal } from "./artifact-share-modal";
import { downloadArtifact } from "@/lib/artifact-download";
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

function CodeArtifactView({
  artifact,
  sessionId,
  version,
}: {
  artifact: Artifact;
  sessionId?: string | null;
  version?: number | null;
}) {
  const t = useTranslations("artifacts");
  const lang = (artifact.lang ?? "").toLowerCase().trim();
  const runnable = RUNNABLE_LANGS.has(lang);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 재방문 복원 — 이 아티팩트의 마지막 실행 결과를 히스토리에서 불러온다(있으면).
  // 본인 아티팩트가 아니거나 실행 이력이 없으면 조용히 무시.
  useEffect(() => {
    if (!sessionId || !artifact.id || !runnable) return;
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<{ data: { executions: (ExecResult & { createdAt: string })[] } }>(
          `/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifact.id)}/executions?limit=1`,
        );
        const last = res.data?.executions?.[0];
        if (alive && last) {
          setResult(last);
          setRestored(true);
        }
      } catch {
        /* 이력 없음/권한 없음 — 무시 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [sessionId, artifact.id, runnable]);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setRestored(false);
    try {
      const res = await ApiClient.post<{ data: ExecResult }>("/api/artifacts/execute", {
        lang,
        code: artifact.content,
        // 아티팩트 컨텍스트 — 백엔드가 본인 아티팩트면 결과를 히스토리에 저장(자동).
        ...(sessionId && version != null ? { sessionId, artifactId: artifact.id, version } : {}),
      });
      setResult(res.data);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 503) setError(t("exec.disabled"));
        else if (e.status === 429) setError(t("exec.rateLimited"));
        else if (e.status === 400) setError(t("exec.unsupportedLang"));
        else if (e.status === 413) setError(t("exec.tooLarge"));
        else setError(e.message);
      } else {
        setError(t("exec.failed"));
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
            {running ? t("run.running") : t("run.run")}
          </button>
          <span className="text-[11px] text-faint">{t("run.sandbox", { lang })}</span>
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
              <span>{t("output.title")}</span>
              <span className="font-mono">exit={result.exitCode ?? "—"}</span>
              <span className="font-mono">{result.durationMs}ms</span>
              {result.timedOut && <span className="text-danger">{t("output.timedOut")}</span>}
              {result.truncated && <span className="text-faint">{t("output.truncated")}</span>}
              {restored && <span className="ml-auto text-faint">{t("run.restored")}</span>}
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
              <p className="px-3 py-2 text-xs text-faint">{t("output.empty")}</p>
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

export function ArtifactBody({
  artifact,
  view,
  sessionId,
  version,
}: {
  artifact: Artifact;
  view: "preview" | "code";
  sessionId?: string | null;
  version?: number | null;
}) {
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
  if (kind === "code") return <CodeArtifactView artifact={artifact} sessionId={sessionId} version={version} />;
  // 미지원 kind → 코드 폴백
  return (
    <div className="h-full overflow-auto px-3">
      <Markdown content={"```\n" + content + "\n```"} />
    </div>
  );
}

export function ArtifactPanel() {
  const t = useTranslations("artifacts");
  const artifacts = useAppStore((s) => s.artifacts);
  const activeArtifactId = useAppStore((s) => s.activeArtifactId);
  const open = useAppStore((s) => s.artifactPanelOpen);
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const setActiveArtifact = useAppStore((s) => s.setActiveArtifact);
  const setArtifactPanelOpen = useAppStore((s) => s.setArtifactPanelOpen);
  const setArtifacts = useAppStore((s) => s.setArtifacts);

  const [view, setView] = useState<"preview" | "code">("preview");
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // 버전 피커 — 활성 artifact 의 전체 버전 + 표시중 버전 override.
  const [versions, setVersions] = useState<{ version: number }[]>([]);
  const [override, setOverride] = useState<{ version: number; artifact: Artifact } | null>(null);

  // ── 패널 가로 리사이즈 (데스크톱) ── 고정 폭 대신 드래그로 조절, localStorage 영속.
  const PANEL_MIN = 360;
  const PANEL_DEFAULT = 560;
  const PANEL_STORAGE_KEY = "omk_artifact_panel_w";
  const [panelWidth, setPanelWidth] = useState<number>(PANEL_DEFAULT);
  const draggingRef = useRef(false);

  useEffect(() => {
    const saved = Number(localStorage.getItem(PANEL_STORAGE_KEY));
    if (Number.isFinite(saved) && saved >= PANEL_MIN) setPanelWidth(saved);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, String(Math.round(panelWidth)));
    } catch {
      /* 저장소 접근 불가 — 무시 */
    }
  }, [panelWidth]);

  // 뷰포트가 좁아지면 채팅 영역(최소 400px) 보장 위해 폭 클램프.
  const clampWidth = useCallback((w: number) => {
    const maxW = Math.max(PANEL_MIN, window.innerWidth - 400);
    return Math.min(maxW, Math.max(PANEL_MIN, w));
  }, []);

  useEffect(() => {
    const onResize = () => setPanelWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampWidth]);

  const startResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        // 패널은 화면 우측 → 폭 = 뷰포트 우측 끝 - 커서 X.
        setPanelWidth(clampWidth(window.innerWidth - ev.clientX));
      };
      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [clampWidth],
  );

  // 세션 진입 시 영속 아티팩트 복원 (메모리에 없을 때만 — 라이브 스트림 보호)
  useEffect(() => {
    if (!currentSessionId) return;
    if (useAppStore.getState().artifacts.length > 0) return;
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<{ data?: { artifacts?: PersistedArtifact[] } }>(
          appendAnonSessionId(`/api/sessions/${currentSessionId}/artifacts`),
          { redirectOnUnauthorized: false },
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

  // 활성 artifact 변경 시 버전 목록 로드 + override 초기화.
  useEffect(() => {
    setOverride(null);
    setVersions([]);
    if (!currentSessionId || !active || active.streaming) return;
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<ApiSuccess<{ versions: { version: number }[] }>>(
          appendAnonSessionId(`/api/sessions/${encodeURIComponent(currentSessionId)}/artifacts/${encodeURIComponent(active.id)}/versions`),
          { redirectOnUnauthorized: false },
        );
        if (alive) setVersions(res.data?.versions ?? []);
      } catch {
        /* 미저장/미인증 — 버전 피커 숨김 */
      }
    })();
    return () => { alive = false; };
    // active.id 만 의존 (content 변경 시 재조회 불필요)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId, active?.id]);

  const selectVersion = async (v: number) => {
    if (!currentSessionId || !active) return;
    const latest = versions.length ? versions[versions.length - 1].version : v;
    if (v === latest) { setOverride(null); return; }
    try {
      const res = await ApiClient.get<ApiSuccess<{ kind: string; title: string; language: string | null; content: string; version: number }>>(
        appendAnonSessionId(`/api/sessions/${encodeURIComponent(currentSessionId)}/artifacts/${encodeURIComponent(active.id)}/v/${v}`),
        { redirectOnUnauthorized: false },
      );
      const d = res.data;
      setOverride({ version: v, artifact: { id: active.id, kind: d.kind, title: d.title, lang: d.language, content: d.content } });
    } catch {
      /* noop */
    }
  };

  if (!open || !active) return null;

  // 표시 대상 — 버전 override 가 있으면 그 버전, 없으면 최신(store).
  const shown = override?.artifact ?? active;
  const latestVersion = versions.length ? versions[versions.length - 1].version : null;
  const shownVersion = override?.version ?? latestVersion;
  const canShare = !!currentSessionId && !active.streaming;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shown.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 불가 무시 */
    }
  };

  const canToggle = previewKindFor(shown.kind, shown.lang) !== null && !active.streaming;

  return (
    <aside
      style={{ ["--panel-w" as string]: `${panelWidth}px` }}
      className="fixed inset-0 z-40 flex w-full flex-col border-border bg-surface lg:relative lg:inset-auto lg:z-auto lg:w-[var(--panel-w)] lg:border-l"
    >
      {/* 가로 리사이즈 핸들 — 데스크톱만. 패널 좌측 가장자리를 드래그. */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setPanelWidth(clampWidth(PANEL_DEFAULT))}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resize")}
        title={t("resize")}
        className="absolute left-0 top-0 z-20 hidden h-full w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-accent/40 lg:block"
      />
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
          {shown.kind}
          {shown.lang ? `·${shown.lang}` : ""}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{shown.title}</span>
        {active.streaming && <span className="text-[11px] text-faint">{t("generating")}</span>}
        {versions.length > 1 && shownVersion != null && (
          <select
            value={shownVersion}
            onChange={(e) => selectVersion(Number(e.target.value))}
            aria-label={t("versionSelect")}
            className="rounded border border-border bg-surface-2 px-1.5 py-1 text-[11px] text-muted"
          >
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}{v.version === latestVersion ? ` (${t("latest")})` : ""}
              </option>
            ))}
          </select>
        )}
        {canToggle && (
          <button
            type="button"
            onClick={() => setView((v) => (v === "preview" ? "code" : "preview"))}
            aria-label={view === "preview" ? t("viewCode") : t("viewPreview")}
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
          >
            {view === "preview" ? <Code2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => downloadArtifact({ title: shown.title, kind: shown.kind, lang: shown.lang, content: shown.content })}
          aria-label={t("download")}
          className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          <Download className="h-4 w-4" />
        </button>
        {canShare && (
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            aria-label={t("shareLabel")}
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label={t("copy")}
          className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setArtifactPanelOpen(false)}
          aria-label={t("closePanel")}
          className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface-3 hover:text-fg"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {shareOpen && currentSessionId && (
        <ArtifactShareModal
          sessionId={currentSessionId}
          artifactId={active.id}
          onCloseAction={() => setShareOpen(false)}
        />
      )}

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
        <ArtifactBody artifact={shown} view={canToggle ? view : "preview"} sessionId={currentSessionId} version={shownVersion} />
      </div>
    </aside>
  );
}
