"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Sparkles,
  Check,
  LoaderCircle,
  X,
  Trash2,
  RotateCcw,
  RefreshCw,
  Users,
  ChevronRight,
  CalendarClock,
  Plus,
  Play,
  FileStack,
  Circle,
  CircleDot,
  CircleCheck,
  CircleX,
  Download,
  ExternalLink,
  Eye,
  type LucideIcon,
} from "lucide-react";
import { ArtifactFrame } from "@/components/chat/artifact-frame";
import {
  Button,
  Badge,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { SteeringInput } from "@/components/chat/steering-input";
import { SharePanel } from "@/components/agent-tasks/share-panel";
import { DiffView } from "@/components/chat/diff-view";

/* ── 타입 ────────────────────────────────────────────────── */
type TaskStatus = "running" | "completed" | "pending";
type ApiTaskStatus = "pending" | "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

interface ChecklistItem {
  label: string;
  done: boolean;
}

interface AgentTask {
  id: string;
  goal: string;
  status: TaskStatus;
  rawStatus: ApiTaskStatus;
  model: string;
  elapsed: string;
  /** 시작(생성) 시각 ISO — 목록에서 경과시간과 함께 표시. */
  startedAt?: string;
  currentTurn: number;
  maxTurns: number;
  progress: number;
  checklist: ChecklistItem[];
  resumable?: boolean;
  /** 누적 LLM 토큰(4-4) — terminal 시 기록. */
  totalTokens?: number;
  /** Cowork D2: 'local' 이면 데스크톱 브리지 폴더에서 실행 */
  executor?: "sandbox" | "local";
  /** 폴더 선택(102): 연결 루트 기준 실행 폴더 — 미지정은 루트 */
  folderRel?: string;
  /** 실패 사유 — 코드(goal_incomplete/max_turns_exhausted/interrupted) 또는 자유 텍스트. */
  error?: string;
  /** 소유자 id — admin 전체 보기(viewAll)에서 타 사용자 작업 뱃지 표시용. */
  ownerId?: string;
}

type PlanStepStatus = "not_started" | "in_progress" | "completed" | "blocked";
interface PlanStep {
  text: string;
  status: PlanStepStatus;
  note?: string;
}

interface ApiAgentTask {
  id: string;
  goal: string;
  status: ApiTaskStatus;
  progress?: number;
  current_turn?: number;
  max_turns?: number;
  model?: string;
  created_at?: string;
  completed_at?: string;
  resumable?: boolean;
  plan?: PlanStep[] | null;
  total_tokens?: number | null;
  /** Cowork D2: 실행 백엔드 — 'local' 이면 데스크톱 브리지 폴더에서 실행됨 */
  executor?: "sandbox" | "local";
  /** 폴더 선택(102) — 연결 루트 기준 실행 폴더 (folder_rel 컬럼) */
  folder_rel?: string | null;
  /** 실패 사유 (toPublicTask 가 노출하는 error 컬럼) */
  error?: string;
  /** 최종 답변 본문 — toPublicTask 가 ...rest 로 그대로 노출한다(취소 작업은 null). */
  result?: string | null;
  /** 소유자 (toPublicTask 가 user_id 그대로 노출 — admin viewAll 에서 소유자 뱃지용) */
  user_id?: string | number;
}

type TaskFilesResponse = ApiSuccess<{ files: string[] }>;

interface ApiTaskStep {
  id: string;
  turn: number;
  type?: string;
  step_type?: string;
  content?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: string;
  /** 스텝 기록 시점의 플랜 단계 인덱스(0-base, 088) — 없으면 플랜 외 구간 */
  plan_step_index?: number | null;
  created_at?: string;
}

type AgentTasksResponse = ApiSuccess<{ tasks: ApiAgentTask[]; total: number }>;
type AgentTaskDetailResponse = ApiSuccess<{ task: ApiAgentTask; steps: ApiTaskStep[] }>;
/** 서브에이전트 활동(109) — delegate/spawn 서브 1개 = trace 1개 */
interface SubagentTraceView {
  traceId: string;
  origin: string;
  subIndex: number;
  label: string | null;
  startedAt: string;
  steps: { seq: number; type: string; tool: string | null; content: string | null; at: string }[];
}
type SubagentsResponse = ApiSuccess<{ traces: SubagentTraceView[] }>;

/* ── 유틸 ────────────────────────────────────────────────── */
function mapStatus(s: ApiTaskStatus): TaskStatus {
  if (s === "running" || s === "paused") return "running";
  if (s === "completed" || s === "failed" || s === "cancelled") return "completed";
  return "pending";
}

type TFn = ReturnType<typeof useTranslations>;

function formatElapsed(t: TFn, start?: string, end?: string): string {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return "—";
  const sec = Math.round((e - s) / 1000);
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m > 0
    ? t("elapsedMinSec", { m, s: String(r).padStart(2, "0") })
    : t("elapsedSec", { s: r });
}

/**
 * 목록용 시작 시각 — 연도는 생략해 카드 메타 줄을 짧게 유지하고, 전체 시각은 title 로 노출한다.
 * 로그성 목록이라 12시간제(오전/오후)보다 24시간제가 읽기 쉽다.
 */
function formatStartedAt(iso: string | undefined, locale: string): { short: string; full: string } | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return {
    short: d.toLocaleString(locale, {
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }),
    full: d.toLocaleString(locale),
  };
}

function mapTask(tr: TFn, t: ApiAgentTask): AgentTask {
  const status = mapStatus(t.status);
  const progress =
    typeof t.progress === "number"
      ? Math.max(0, Math.min(100, t.progress))
      : status === "completed"
        ? 100
        : 0;
  return {
    id: t.id,
    goal: t.goal,
    status,
    rawStatus: t.status,
    model: t.model || "Auto",
    elapsed: formatElapsed(tr, t.created_at, t.completed_at),
    startedAt: t.created_at,
    currentTurn: t.current_turn ?? 0,
    maxTurns: t.max_turns ?? 0,
    progress,
    checklist: [],
    resumable: t.resumable,
    totalTokens: typeof t.total_tokens === "number" ? t.total_tokens : undefined,
    executor: t.executor,
    folderRel: t.folder_rel || undefined,
    error: t.error || undefined,
    ownerId: t.user_id != null ? String(t.user_id) : undefined,
  };
}

/** 실패 사유 코드 — i18n 번역 대상. 그 외 값은 자유 텍스트로 원문 표시. */
// "aborted" 는 사용자 취소 시 error 컬럼에 들어간다 — 번역 대상에 없어 원문이 그대로
// 노출되고 있었다(결과 블록이 취소 사유를 표시하면서 드러남).
const KNOWN_ERROR_CODES = new Set(["goal_incomplete", "max_turns_exhausted", "interrupted", "aborted"]);
/** 재개 가능한 사유 — resume 버튼과 시각적으로 연결. */
const RESUMABLE_ERROR_CODES = new Set(["max_turns_exhausted", "interrupted"]);

/** 실패 사유 라벨: 알려진 코드는 번역, 그 외는 원문 축약(전문은 tooltip). */
function errorReasonLabel(tr: TFn, error: string): string {
  return KNOWN_ERROR_CODES.has(error)
    ? tr(`errorReason.${error}`)
    : error.length > 48 ? `${error.slice(0, 48)}…` : error;
}

const STATUS_META: Record<TaskStatus, { labelKey: string; tone: "accent" | "success" | "neutral" }> = {
  running: { labelKey: "status.running", tone: "accent" },
  completed: { labelKey: "status.completed", tone: "success" },
  pending: { labelKey: "status.pending", tone: "neutral" },
};

/* ── 오버레이 모달 ────────────────────────────────────────── */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-xl max-h-[90vh] overflow-y-auto mx-4 rounded-lg border border-border bg-app shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── 아티팩트 스텝 뷰 ──────────────────────────────────────
 * 에이전트 작업의 산출물은 step_type='artifact' 스텝에 ExtractedArtifact JSON 으로 실려 온다.
 * 일반 스텝과 같이 4,000자로 잘라 원시 JSON 을 보여주면 산출물을 확인할 수 없어(실측 16KB
 * HTML 이 1/4 지점에서 절단) 전용 뷰로 분리한다 — 제목·종류 헤더 + 본문 전체 + 다운로드/열기.
 */
interface StepArtifact {
  id: string;
  kind: string;
  title: string;
  lang?: string | null;
  content: string;
}

/** 스텝 content(JSON 문자열)를 아티팩트로 파싱 — 형식이 다르면 null(일반 스텝으로 폴백). */
function parseStepArtifact(raw: string): StepArtifact | null {
  try {
    const o = JSON.parse(raw) as Partial<StepArtifact>;
    if (typeof o?.content !== "string" || typeof o?.kind !== "string") return null;
    return {
      id: typeof o.id === "string" ? o.id : "artifact",
      kind: o.kind,
      title: typeof o.title === "string" ? o.title : "artifact",
      lang: o.lang ?? null,
      content: o.content,
    };
  } catch {
    return null;
  }
}

const ARTIFACT_MIME: Record<string, string> = {
  html: "text/html",
  svg: "image/svg+xml",
  markdown: "text/markdown",
  csv: "text/csv",
};

function ArtifactStepView({ artifact }: { artifact: StepArtifact }) {
  const t = useTranslations("agentTasks");
  const [open, setOpen] = useState(false);
  const mime = ARTIFACT_MIME[artifact.kind] ?? "text/plain";
  const ext = artifact.kind === "markdown" ? "md" : artifact.kind === "code" ? (artifact.lang || "txt") : artifact.kind;

  // Blob URL 은 클릭 시점에만 만들고 즉시 해제 — 모달 수명 동안 누수되지 않게 한다.
  const withBlobUrl = (fn: (url: string) => void) => {
    const url = URL.createObjectURL(new Blob([artifact.content], { type: `${mime};charset=utf-8` }));
    fn(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const download = () => withBlobUrl((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.id}.${ext}`;
    a.click();
  });
  const openTab = () => withBlobUrl((url) => window.open(url, "_blank", "noopener"));

  return (
    <div className="mt-1 rounded-md border border-accent/40 bg-surface-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
        <Badge tone="accent">{artifact.kind}</Badge>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{artifact.title}</span>
        <span className="text-[11px] text-muted">
          {t("artifactSize", { chars: artifact.content.length })}
        </span>
        {(artifact.kind === "html" || artifact.kind === "svg") && (
          <Button size="sm" variant="outline" onClick={openTab} title={t("artifactOpen")}>
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={download} title={t("artifactDownload")}>
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
      {/* 본문은 잘리지 않는다 — 기본은 접어 두고 토글로 전체를 연다. */}
      <pre
        className={`overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted ${
          open ? "max-h-[32rem]" : "max-h-32"
        }`}
      >
        {artifact.content}
      </pre>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full border-t border-border px-2 py-1 text-[11px] text-accent hover:bg-surface"
      >
        {open ? t("templates.collapse") : t("templates.expand")}
      </button>
    </div>
  );
}

/* ── 프롬프트(goal) 블록 ───────────────────────────────────
 * goal 은 역할·절차·제약이 담긴 여러 줄 프롬프트다(실측 96줄). 일반 <p> 로 렌더하면
 * HTML 이 줄바꿈을 공백으로 접어 한 문단이 되어 구조를 읽을 수 없다 → 줄바꿈을 보존하되
 * 기본은 접어 두고 토글로 전체를 연다.
 */
function GoalBlock({ goal }: { goal: string }) {
  const t = useTranslations("agentTasks");
  const [open, setOpen] = useState(false);
  const multiline = goal.includes("\n") || goal.length > 200;
  return (
    <>
      <pre
        className={`whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-fg ${
          open ? "max-h-[28rem] overflow-auto" : "line-clamp-4"
        }`}
      >
        {goal}
      </pre>
      {multiline && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[11px] text-accent hover:underline"
        >
          {open ? t("templates.collapse") : t("templates.expand")}
        </button>
      )}
    </>
  );
}

/* ── 산출물 미리보기 모달 ──────────────────────────────────
 * 이력 카드에서 상세 모달·타임라인을 거치지 않고 산출물만 바로 확인한다.
 * 아티팩트는 갤러리와 같은 저장소(artifacts, session_id='task:<id>')에서 읽으므로
 * 채팅 산출물과 동일한 엔드포인트를 그대로 쓴다.
 */
interface ApiArtifactRow {
  artifact_id: string;
  version: number;
  kind: string;
  title: string;
  language: string | null;
  content: string;
}
type SessionArtifactsResponse = ApiSuccess<{ artifacts: ApiArtifactRow[]; total: number }>;

/** html·svg 는 라이브 렌더, 그 외는 원문 텍스트. */
const RENDERABLE_KINDS = new Set(["html", "svg"]);

function PreviewModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const t = useTranslations("agentTasks");
  const [rows, setRows] = useState<ApiArtifactRow[] | null>(null);
  const [sel, setSel] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sid = encodeURIComponent(`task:${taskId}`);
        const r = await ApiClient.get<SessionArtifactsResponse>(`/api/sessions/${sid}/artifacts`);
        if (!cancelled) setRows(r?.data?.artifacts ?? []);
      } catch {
        if (!cancelled) { setRows([]); setFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);

  const cur = rows?.[sel];
  return (
    <Modal open onClose={onClose} title={t("previewTitle")}>
      {rows === null ? (
        <div className="flex justify-center py-10"><LoaderCircle className="h-5 w-5 animate-spin text-muted" /></div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">
          {failed ? t("previewLoadError") : t("previewEmpty")}
        </p>
      ) : (
        <div className="space-y-2">
          {/* 산출물이 여러 개면 탭으로 전환 */}
          {rows.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {rows.map((a, i) => (
                <button
                  key={`${a.artifact_id}-${i}`}
                  type="button"
                  onClick={() => setSel(i)}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    i === sel ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:bg-surface-2"
                  }`}
                >
                  {a.title}
                </button>
              ))}
            </div>
          )}
          {cur && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{cur.kind}</Badge>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{cur.title}</span>
                <span className="text-[11px] text-muted">{t("artifactSize", { chars: cur.content.length })}</span>
              </div>
              {RENDERABLE_KINDS.has(cur.kind) ? (
                // ArtifactFrame: sandbox="allow-scripts" (allow-same-origin 없음) 로 격리 렌더.
                <div className="h-[70vh] overflow-hidden rounded-md border border-border">
                  <ArtifactFrame srcDoc={cur.content} title={cur.title} />
                </div>
              ) : (
                <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-fg-2">
                  {cur.content}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/* ── 결과 블록 ─────────────────────────────────────────────
 * 종료된 작업(완료/실패/취소)의 결말을 모달 상단에 모아 보여준다. 예전에는 결말이
 * 스텝 타임라인 맨 아래에 원시 텍스트로 섞여 있어, 성공했는지·왜 끝났는지·산출물이
 * 무엇인지 확인하려면 수십 개 스텝을 스크롤해야 했다.
 *   - 완료      → success 뱃지 + 최종 답변 + 산출물(아티팩트) 카드
 *   - 취소/실패 → warn/danger 뱃지 + 종료 사유 + 남은 본문(있으면)
 */
function ResultBlock({ task, steps }: { task: ApiAgentTask; steps: ApiTaskStep[] }) {
  const t = useTranslations("agentTasks");
  const [open, setOpen] = useState(false);

  const terminal = task.status === "completed" || task.status === "failed" || task.status === "cancelled";
  if (!terminal) return null;

  const tone = task.status === "completed" ? "success" : task.status === "cancelled" ? "warn" : "danger";
  const labelKey = task.status === "completed" ? "status.completed"
    : task.status === "cancelled" ? "cancelledTag" : "failedTag";

  // 타임라인의 아티팩트 스텝을 결과 영역으로 끌어올린다 — 산출물이 결말의 핵심이다.
  const artifacts = steps
    .filter((st) => (st.step_type ?? st.type) === "artifact")
    .map((st) => parseStepArtifact(st.tool_output || st.content || ""))
    .filter((a): a is StepArtifact => a !== null);

  const body = (task.result ?? "").trim();

  return (
    <div className="rounded-md border border-border bg-surface-1 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{t(labelKey)}</Badge>
        <span className="text-xs font-medium text-fg-2">{t("resultLabel")}</span>
        {/* 종료 사유는 실패뿐 아니라 취소(aborted)에도 있다. */}
        {task.error && (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
              task.status === "cancelled"
                ? "border-warn/40 bg-warn-soft text-warn"
                : "border-danger/40 bg-danger-soft text-danger"
            }`}
            title={task.error}
          >
            {errorReasonLabel(t, task.error)}
          </span>
        )}
      </div>

      {body ? (
        <>
          <pre
            className={`whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-2 ${
              open ? "max-h-[28rem] overflow-auto" : "line-clamp-6"
            }`}
          >
            {body}
          </pre>
          {(body.includes("\n") || body.length > 300) && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-[11px] text-accent hover:underline"
            >
              {open ? t("templates.collapse") : t("templates.expand")}
            </button>
          )}
        </>
      ) : (
        <p className="text-xs text-muted">{t("noResultBody")}</p>
      )}

      {artifacts.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium text-fg-2">
            {t("outputsLabel", { count: artifacts.length })}
          </p>
          <div className="space-y-2">
            {artifacts.map((a, i) => <ArtifactStepView key={`${a.id}-${i}`} artifact={a} />)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 작업 상세 모달 (스텝 타임라인) ─────────────────────── */
const PLAN_MARK: Record<PlanStepStatus, LucideIcon> = {
  not_started: Circle,
  in_progress: CircleDot,
  completed: CircleCheck,
  blocked: CircleX,
};

function TaskDetailModal({
  taskId,
}: {
  taskId: string;
}) {
  const t = useTranslations("agentTasks");
  const [detail, setDetail] = useState<{ task: ApiAgentTask; steps: ApiTaskStep[] } | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [subagents, setSubagents] = useState<SubagentTraceView[]>([]);
  const [loading, setLoading] = useState(true);

  // 라이브 폴링: 실행 중(running/paused)이면 주기적으로 갱신 — "컴퓨터" 패널 실시간성.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const res = await ApiClient.get<AgentTaskDetailResponse>(`/api/agent-tasks/${taskId}`);
        if (cancelled) return;
        setDetail(res?.data ?? null);
        const st = res?.data?.task?.status;
        // 서브에이전트 활동(109) — 위임/fan-out 이 있던 작업만 값이 있다. 실패는 빈 목록.
        try {
          const sa = await ApiClient.get<SubagentsResponse>(`/api/agent-tasks/${taskId}/subagents`);
          if (!cancelled) setSubagents(sa?.data?.traces ?? []);
        } catch { /* ignore */ }
        // 완료 task 의 산출물 파일 목록(보존된 workspace).
        if (st === "completed") {
          try {
            const f = await ApiClient.get<TaskFilesResponse>(`/api/agent-tasks/${taskId}/files`);
            if (!cancelled) setFiles(f?.data?.files ?? []);
          } catch { /* ignore */ }
        }
        // 진행 중(또는 대기 중)이면 계속 폴링.
        if (!cancelled && (st === "running" || st === "paused" || st === "pending" || st === "queued")) {
          timer = setTimeout(load, 2500);
        }
      } catch {
        // detail 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [taskId]);

  const plan = detail?.task.plan ?? [];

  return (
    <div className="space-y-4">
      {loading && !detail ? (
        <div className="flex items-center gap-2 py-8 justify-center text-muted text-sm">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          {t("loading")}
        </div>
      ) : !detail ? (
        <p className="text-sm text-danger py-8 text-center">{t("detailLoadError")}</p>
      ) : (
        <>
          <div className="rounded-md border border-border bg-surface-2 p-4">
            <p className="mb-1 text-xs font-medium text-muted">{t("goalLabel")}</p>
            <GoalBlock goal={detail.task.goal} />
            {detail.task.executor === "local" && (
              <span className="mt-2 inline-flex items-center rounded-full border border-accent bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">
                {t("localBadge")}{detail.task.folder_rel ? ` · ${detail.task.folder_rel}` : ""}
              </span>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs text-faint">
              <span className="flex items-center gap-1">
                {t("stateLabel")} {detail.task.status}
                {(detail.task.status === "running" || detail.task.status === "paused") && (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                )}
              </span>
              <span>{t("turnLabel")} {detail.task.current_turn ?? 0}/{detail.task.max_turns ?? 0}</span>
            </div>
            {/* 실패 사유 — 상세에도 노출(카드와 동일 규칙) */}
            {detail.task.status === "failed" && detail.task.error && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-muted">{t("errorReason.label")}</span>
                <span
                  className="inline-flex items-center rounded-md border border-danger/40 bg-danger-soft px-2 py-0.5 font-medium text-danger"
                  title={detail.task.error}
                >
                  {errorReasonLabel(t, detail.task.error)}
                </span>
                {RESUMABLE_ERROR_CODES.has(detail.task.error) && (
                  <span className="text-faint">{t("errorReason.resumableHint")}</span>
                )}
              </div>
            )}
          </div>

          {/* 종료된 작업의 결말 — 계획·타임라인보다 위에 둔다. */}
          <ResultBlock task={detail.task} steps={detail.steps} />

          {/* 공유 — 종료된 작업만(스냅샷 고정이라 진행 중 게시는 반쪽 기록이 굳는다). */}
          {(detail.task.status === "completed" || detail.task.status === "failed" || detail.task.status === "cancelled") && (
            <SharePanel taskId={taskId} />
          )}

          {/* 실행 중/일시정지 시 방향 지시(steering) — 취소·재시작 없이 교정. */}
          {(detail.task.status === "running" || detail.task.status === "paused") && (
            <SteeringInput taskId={taskId} />
          )}

          {/* 계획 패널 (G3 plan + G5 실시간 상태) */}
          {plan.length > 0 && (
            <div className="rounded-md border border-border bg-surface-1 p-3">
              <p className="mb-2 text-xs font-medium text-fg-2">
                {t("planLabel", { completed: plan.filter((s) => s.status === "completed").length, total: plan.length })}
              </p>
              <ul className="space-y-1">
                {plan.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    <span className={cn(
                      "mt-0.5",
                      s.status === "completed" && "text-success",
                      s.status === "in_progress" && "text-warning",
                      s.status === "blocked" && "text-danger",
                      s.status === "not_started" && "text-faint",
                    )}>
                      {(() => { const Icon = PLAN_MARK[s.status]; return <Icon className="h-3.5 w-3.5" aria-label={s.status} />; })()}
                    </span>
                    <span className={cn(
                      "min-w-0 flex-1",
                      s.status === "completed" ? "text-muted line-through" : "text-fg-2",
                    )}>
                      {s.text}{s.note ? <span className="text-faint"> — {s.note}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}


          {/* 산출물 파일 (완료 시 workspace 보존) */}
          {files.length > 0 && (
            <div className="rounded-md border border-border bg-surface-1 p-3">
              <p className="mb-2 text-xs font-medium text-fg-2">{t("outputsLabel", { count: files.length })}</p>
              <ul className="space-y-1">
                {files.map((f) => (
                  <li key={f} className="text-xs">
                    <button
                      type="button"
                      onClick={() => void ApiClient.download(
                        `/api/agent-tasks/${taskId}/files/download?path=${encodeURIComponent(f)}`,
                        f.split("/").pop() || f,
                      ).catch((e) => alert(t("downloadFailed", { error: e instanceof Error ? e.message : "error" })))}
                      className="font-mono text-accent hover:underline"
                    >
                      {f}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 서브에이전트 활동(109) — delegate/spawn 서브가 실제로 무엇을 했는지. 부모 스텝에는 결과만 남는다. */}
          {subagents.length > 0 && (
            <div className="rounded-md border border-border bg-surface-1 p-3">
              <p className="mb-2 text-xs font-medium text-fg-2">{t("subagents.title", { count: subagents.length })}</p>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {subagents.map((tr) => (
                  <div key={`${tr.traceId}:${tr.subIndex}`} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge tone="accent">{tr.origin === "spawn_agents" ? t("subagents.originSpawn", { n: tr.subIndex + 1 }) : t("subagents.originDelegate")}</Badge>
                      {tr.label && <span className="text-muted">{tr.label}</span>}
                      <span className="text-faint">{t("subagents.stepCount", { count: tr.steps.length })}</span>
                    </div>
                    <ul className="space-y-0.5 pl-2">
                      {tr.steps.map((st) => (
                        <li key={st.seq} className="flex gap-2 text-[11px]">
                          <span className={cn("shrink-0 font-mono", st.type === "error" ? "text-danger" : st.type === "final" ? "text-success" : "text-faint")}>
                            {st.tool ?? st.type}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted" title={st.content ?? ""}>{st.content}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 실행 스텝 — 터미널 스타일(도구 출력 전문) */}
          {detail.steps.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">{t("noSteps")}</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-medium text-fg-2">{t("stepsLabel", { count: detail.steps.length })}</p>
              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {detail.steps.map((step, i) => {
                  const body = step.tool_output || step.content || "";
                  const stepType = step.step_type ?? step.type;
                  const isDiff = stepType === "diff";
                  // 아티팩트 스텝은 전용 뷰 — 파싱 실패 시 null 이라 일반 스텝으로 자연 폴백된다.
                  const artifact = stepType === "artifact" ? parseStepArtifact(body) : null;
                  const isTool = !artifact && (stepType === "tool_result" || !!step.tool_name);
                  return (
                    <div key={step.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-mono text-faint">
                          {i + 1}
                        </div>
                        {i < detail.steps.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className="pb-3 min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted mb-0.5">
                          <Badge tone="neutral">{stepType ?? "step"}</Badge>
                          {typeof step.plan_step_index === "number" && (
                            <Badge tone="accent">{t("planNode", { n: step.plan_step_index + 1 })}</Badge>
                          )}
                          {step.tool_name && <span className="font-mono">{step.tool_name}</span>}
                        </div>
                        {body && (artifact ? (
                          <ArtifactStepView artifact={artifact} />
                        ) : isDiff ? (
                          <DiffView text={body.slice(0, 20000)} />
                        ) : (
                          <pre className={cn(
                            "mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded px-2 py-1 text-xs leading-relaxed",
                            isTool ? "bg-surface-2 font-mono text-muted" : "text-fg-2",
                          )}>
                            {body.slice(0, 4000)}
                          </pre>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── 메인 페이지 ──────────────────────────────────────────── */
/* ── 승인 대기 패널 (HITL 게이트) ──────────────────────────── */
/* ── 스케줄(반복 트리거) 패널 (Phase 3-A) ───────────────────── */
interface ApiSchedule {
  id: string;
  goal: string;
  cron?: string | null;
  interval_seconds?: number | null;
  max_turns: number;
  enabled: boolean;
  next_run_at: string;
  last_run_at?: string | null;
  consecutive_failures: number;
}
type SchedulesResponse = ApiSuccess<{ schedules: ApiSchedule[]; total: number }>;

function SchedulesPanel() {
  const t = useTranslations("agentTasks");
  const [schedules, setSchedules] = useState<ApiSchedule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [goal, setGoal] = useState("");
  const [kind, setKind] = useState<"cron" | "interval">("cron");
  const [cron, setCron] = useState("0 8 * * *");
  const [intervalMin, setIntervalMin] = useState(60);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<SchedulesResponse>("/api/agent-task-schedules");
      setSchedules(r?.data?.schedules ?? []);
    } catch {
      // 401·네트워크·플래그 OFF(404): 빈 목록 유지
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try {
      await fn();
      await load();
    } catch (err) {
      alert(t("processFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run("new", async () => {
      const body = kind === "cron" ? { goal, cron } : { goal, intervalSeconds: Math.max(300, intervalMin * 60) };
      await ApiClient.post("/api/agent-task-schedules", body);
      setGoal("");
      setOpen(false);
    });
  const toggle = (s: ApiSchedule) =>
    run(s.id, () => ApiClient.patch(`/api/agent-task-schedules/${s.id}`, { enabled: !s.enabled }));
  const runNow = (s: ApiSchedule) => run(s.id, () => ApiClient.post(`/api/agent-task-schedules/${s.id}/run`, {}));
  const remove = (s: ApiSchedule) => run(s.id, () => ApiClient.del(`/api/agent-task-schedules/${s.id}`));

  const timingLabel = (s: ApiSchedule) =>
    s.cron ? s.cron : s.interval_seconds ? t("schedules.everyMinutes", { min: Math.round(s.interval_seconds / 60) }) : "—";

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg-2">
          <CalendarClock className="h-4 w-4 text-accent" /> {t("schedules.title")}
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> {t("schedules.create")}
        </Button>
      </div>

      {open && (
        <div className="mb-3 space-y-2 rounded-md border border-line bg-bg-1 p-3">
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t("schedules.goalPlaceholder")}
            rows={2}
            className="w-full resize-y rounded-md border border-line bg-bg-2 p-2 text-sm text-fg-1"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as "cron" | "interval")}
              className="rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-fg-1"
            >
              <option value="cron">{t("schedules.cron")}</option>
              <option value="interval">{t("schedules.interval")}</option>
            </select>
            {kind === "cron" ? (
              <input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="0 8 * * *"
                className="min-w-40 flex-1 rounded-md border border-line bg-bg-2 px-2 py-1 font-mono text-xs text-fg-1"
              />
            ) : (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="number"
                  min={5}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Math.max(5, Number(e.target.value) || 5))}
                  className="w-20 rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-fg-1"
                />
                {t("schedules.minutes")}
              </label>
            )}
            <Button size="sm" disabled={busy === "new" || !goal.trim()} onClick={create}>
              {t("schedules.add")}
            </Button>
          </div>
          <p className="text-xs text-faint">{t("schedules.cronHint")}</p>
        </div>
      )}

      {schedules.length === 0 ? (
        <p className="text-xs text-muted">{t("schedules.empty")}</p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg-1 p-2">
              <div className="min-w-0">
                <p className="line-clamp-2 whitespace-pre-line text-xs font-medium text-fg-1" title={s.goal}>{s.goal}</p>
                <p className="text-xs text-muted">
                  <span className="font-mono">{timingLabel(s)}</span>
                  {" · "}
                  {t("schedules.nextRun", { time: new Date(s.next_run_at).toLocaleString() })}
                  {!s.enabled && ` · ${t("schedules.disabled")}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" disabled={busy === s.id || !s.enabled} onClick={() => runNow(s)} title={t("schedules.runNow")}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => toggle(s)}>
                  {s.enabled ? t("schedules.disable") : t("schedules.enable")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy === s.id} onClick={() => remove(s)} title={t("schedules.delete")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── 작업 템플릿 패널 (Phase 6-1) ───────────────────────────── */
interface ApiTemplate {
  id: string;
  name: string;
  goal_template: string;
  params?: Array<{ name: string; description?: string; default?: string }> | null;
  max_turns: number;
}
type TemplatesResponse = ApiSuccess<{ templates: ApiTemplate[]; total: number }>;

/** 접기 UI 를 붙일지 판단 — 3줄(line-clamp-3) 을 넘거나 한 줄이라도 길면 true. */
function isMultiline(text: string): boolean {
  return text.includes("\n") || text.length > 120;
}

function TemplatesPanel() {
  const t = useTranslations("agentTasks");
  const [templates, setTemplates] = useState<ApiTemplate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<TemplatesResponse>("/api/agent-task-templates");
      setTemplates(r?.data?.templates ?? []);
    } catch { /* 401·미배포: 빈 목록 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try { await fn(); await load(); }
    catch (err) { alert(t("processFailed", { message: err instanceof Error ? err.message : t("error") })); }
    finally { setBusy(null); }
  }

  const create = () => run("new", async () => {
    await ApiClient.post("/api/agent-task-templates", { name, goalTemplate: goal });
    setName(""); setGoal(""); setOpen(false);
  });
  const instantiate = (tp: ApiTemplate) => run(tp.id, async () => {
    await ApiClient.post(`/api/agent-task-templates/${tp.id}/instantiate`, {});
    alert(t("templates.started"));
  });
  const remove = (tp: ApiTemplate) => run(tp.id, () => ApiClient.del(`/api/agent-task-templates/${tp.id}`));

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg-2">
          <FileStack className="h-4 w-4 text-accent" /> {t("templates.title")}
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
          <Plus className="h-3.5 w-3.5" /> {t("templates.create")}
        </Button>
      </div>
      {open && (
        <div className="mb-3 space-y-2 rounded-md border border-line bg-bg-1 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("templates.namePlaceholder")}
            className="w-full rounded-md border border-line bg-bg-2 px-2 py-1.5 text-sm text-fg-1"
          />
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t("templates.goalPlaceholder")}
            rows={10}
            // 줄바꿈은 그대로 저장된다(서버 sanitize 의 allowNewLines 기본 true) —
            // 여러 줄 목표를 편집할 수 있도록 충분한 높이를 준다.
            className="w-full resize-y whitespace-pre-wrap rounded-md border border-line bg-bg-2 p-2 font-mono text-xs leading-relaxed text-fg-1"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted">
              {t("templates.lineCount", { lines: goal ? goal.split("\n").length : 0, chars: goal.length })}
            </span>
            <Button size="sm" disabled={busy === "new" || !name.trim() || !goal.trim()} onClick={create}>
              {t("templates.add")}
            </Button>
          </div>
        </div>
      )}
      {templates.length === 0 ? (
        <p className="text-xs text-muted">{t("templates.empty")}</p>
      ) : (
        <div className="space-y-2">
          {templates.map((tp) => (
            <div key={tp.id} className="flex items-start justify-between gap-3 rounded-md border border-line bg-bg-1 p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-fg-1">{tp.name}</p>
                {/* goal_template 은 여러 줄이 그대로 저장된다(실측 96줄 사례). 예전에는
                    truncate 로 한 줄로 뭉개져 내용을 확인할 수 없었다 → 줄바꿈을 보존하되
                    기본은 3줄로 접고, 넘칠 때만 펼치기 토글을 노출한다. */}
                <pre
                  className={`mt-0.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted ${
                    expanded === tp.id ? "" : "line-clamp-3"
                  }`}
                >
                  {tp.goal_template}
                </pre>
                {isMultiline(tp.goal_template) && (
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === tp.id ? null : tp.id)}
                    className="mt-1 text-[11px] text-accent hover:underline"
                  >
                    {expanded === tp.id ? t("templates.collapse") : t("templates.expand")}
                  </button>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" disabled={busy === tp.id} onClick={() => instantiate(tp)} title={t("templates.run")}>
                  <Play className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={busy === tp.id} onClick={() => remove(tp)} title={t("templates.delete")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function AgentTasksPage() {
  const t = useTranslations("agentTasks");
  const locale = useLocale();
  const router = useRouter();
  // 실데이터만 — 그전엔 목업 작업 3건(Pro/Default/Fast)이 401 시 실렌더됐다
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [previewTaskId, setPreviewTaskId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // taskId being acted on

  // admin 전체 보기 — 백엔드 ?viewAll=true 재사용 (비관리자의 viewAll 은 서버가 무시).
  // 다른 계정(예: 디스코드 봇 계정) 작업을 이관 없이 함께 열람하는 용도.
  const isAdmin = useAppStore((s) => s.auth.currentUser?.role === "admin");
  const myUserId = useAppStore((s) => s.auth.currentUser?.id);
  const [viewAll, setViewAll] = useState(false);

  const loadTasks = useCallback(async () => {
    try {
      const res = await ApiClient.get<AgentTasksResponse>(
        viewAll ? "/api/agent-tasks?viewAll=true" : "/api/agent-tasks",
      );
      setTasks((res?.data?.tasks ?? []).map((task) => mapTask(t, task)));
    } catch {
      // 401·네트워크 실패: 빈 상태 유지
    } finally {
      setLoading(false);
    }
  }, [t, viewAll]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadTasks();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadTasks]);

  // 히스토리 목록 등 외부 진입 딥링크(?task=<id>) — 마운트 시 1회 상세 모달 직행.
  // (전면 클라이언트 페이지라 useSearchParams 대신 location 직독 — Suspense 경계 불필요)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("task");
    if (id) setDetailTaskId(id);
  }, []);

  async function handleCancel(task: AgentTask) {
    if (!window.confirm(t("cancelConfirm", { goal: task.goal.slice(0, 40) }))) return;
    setActionLoading(task.id);
    try {
      await ApiClient.post(`/api/agent-tasks/${task.id}/cancel`, {});
      await loadTasks();
    } catch (err) {
      alert(t("cancelFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleResume(task: AgentTask) {
    setActionLoading(task.id);
    try {
      await ApiClient.post(`/api/agent-tasks/${task.id}/resume`, {});
      // 낙관적 갱신 — retry 와 동일: detached 시작 직후 GET 은 아직 failed 라
      // resume 버튼이 남아 이중 실행 클릭이 가능하던 창을 닫는다.
      setTasks((prev) =>
        prev.map((x) =>
          x.id === task.id
            ? { ...x, rawStatus: "pending" as ApiTaskStatus, status: mapStatus("pending"), error: undefined }
            : x,
        ),
      );
      setTimeout(() => void loadTasks(), 2000);
    } catch (err) {
      alert(t("resumeFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setActionLoading(null);
    }
  }

  // 처음부터 재시도 — 백엔드 execute 가 failed/cancelled 작업의 fresh 재실행을 지원
  // (이전 스텝 초기화 후 동일 goal·입력으로 turn 1 부터). 토큰을 다시 쓰므로 확인 후 실행.
  async function handleRetry(task: AgentTask) {
    if (!window.confirm(t("retryConfirm", { goal: task.goal.slice(0, 40) }))) return;
    setActionLoading(task.id);
    try {
      await ApiClient.post(`/api/agent-tasks/${task.id}/execute`, {});
      // 낙관적 갱신 — execute 는 detached 라 직후 GET 은 아직 failed 를 반환한다.
      // pending 으로 바꿔 retry 버튼을 즉시 감춰(이중 실행 방지) 시작 피드백을 주고,
      // 잠시 후 실상태로 동기화한다.
      setTasks((prev) =>
        prev.map((x) =>
          x.id === task.id
            ? { ...x, rawStatus: "pending" as ApiTaskStatus, status: mapStatus("pending"), error: undefined }
            : x,
        ),
      );
      setTimeout(() => void loadTasks(), 2000);
    } catch (err) {
      alert(t("retryFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(task: AgentTask) {
    if (!window.confirm(t("deleteConfirm", { goal: task.goal.slice(0, 40) }))) return;
    setActionLoading(task.id);
    try {
      await ApiClient.del(`/api/agent-tasks/${task.id}`);
      await loadTasks();
    } catch (err) {
      alert(t("deleteFailed", { message: err instanceof Error ? err.message : t("error") }));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 실행 안내 배너 — 생성/실행은 채팅 인라인으로 일원화 */}
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            {t.rich("banner", {
              b: (chunks) => <span className="font-medium text-fg-2">{chunks}</span>,
            })}
          </p>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setViewAll((v) => !v)}
                className={cn(viewAll && "border-accent text-accent")}
              >
                <Users className="mr-1.5 h-3.5 w-3.5" />
                {t("viewAllToggle")}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => router.push("/")}>
              {t("chatCta")}
            </Button>
          </div>
        </Card>
        <SchedulesPanel />
        <TemplatesPanel />
        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">{t("emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted">{t("emptyDescription")}</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => router.push("/")}>
              {t("chatCta")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tasks.map((task) => {
              const meta = STATUS_META[task.status];
              const total = task.checklist.length;
              const completed = task.checklist.filter((c) => c.done).length;
              const pct = total ? Math.round((completed / total) * 100) : task.progress;
              const isActing = actionLoading === task.id;

              return (
                <Card key={task.id} className="flex flex-col p-5">
                  {/* 1) 정체성 — 상태·소유자·실행기 배지 + 상세 진입. 턴은 진행률 줄로 내렸다. */}
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {/* mapStatus 는 completed/failed/cancelled 를 모두 "completed" 로 접으므로
                          STATUS_META 만 쓰면 취소·실패도 초록(success)으로 보인다 — 성공이 아닌
                          종료는 톤을 분리한다: 취소=warn(노랑), 실패=danger. */}
                      <Badge tone={
                        task.rawStatus === "cancelled" ? "warn"
                          : task.rawStatus === "failed" ? "danger"
                            : meta.tone
                      }>
                        {task.status === "running" && (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        )}
                        {t(meta.labelKey)}
                        {task.rawStatus === "failed" && ` (${t("failedTag")})`}
                        {task.rawStatus === "cancelled" && ` (${t("cancelledTag")})`}
                      </Badge>
                      {/* 전체 보기에서 타 사용자 작업 구분 뱃지 */}
                      {viewAll && task.ownerId && task.ownerId !== String(myUserId ?? "") && (
                        <Badge tone="neutral">{t("ownerBadge", { id: task.ownerId })}</Badge>
                      )}
                      {task.executor === "local" && (
                        <Badge tone="neutral">{t("localBadge")}</Badge>
                      )}
                    </span>
                    <button
                      onClick={() => setDetailTaskId(task.id)}
                      title={t("detailTitle")}
                      className="-mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-faint transition hover:bg-surface-2 hover:text-fg">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>

                  {/* 실패 사유 — 알려진 코드는 번역, 재개 가능 사유는 resume 안내 병기 */}
                  {task.rawStatus === "failed" && task.error && (
                    <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
                      <span
                        className="inline-flex items-center rounded-md border border-danger/40 bg-danger-soft px-2 py-0.5 font-medium text-danger"
                        title={task.error}
                      >
                        {errorReasonLabel(t, task.error)}
                      </span>
                      {RESUMABLE_ERROR_CODES.has(task.error) && task.resumable && (
                        <span className="text-faint">{t("errorReason.resumableHint")}</span>
                      )}
                    </div>
                  )}

                  {/* whitespace-pre-line: 줄바꿈을 살려 clamp 2줄이 프롬프트의 첫 두 줄이
                      되게 한다(예전엔 전체가 한 줄로 접혀 의미 없는 앞부분만 보였다).
                      전체 프롬프트는 hover title 과 상세 모달에서 확인. */}
                  <h3
                    className="mb-4 line-clamp-2 cursor-pointer whitespace-pre-line text-sm font-semibold leading-snug text-fg hover:underline"
                    onClick={() => setDetailTaskId(task.id)}
                    title={task.goal}
                  >
                    {task.goal}
                  </h3>
                  {total > 0 ? (
                    <ul className="mb-4 flex-1 space-y-1.5">
                      {task.checklist.map((item, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs">
                          <span className={cn(
                            "grid h-4 w-4 flex-shrink-0 place-items-center rounded-full border",
                            item.done ? "border-success bg-success-soft text-success" : "border-border text-faint",
                          )}>
                            {item.done && <Check className="h-2.5 w-2.5" />}
                          </span>
                          <span className={cn(item.done ? "text-fg-2 line-through decoration-faint" : "text-muted")}>
                            {item.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="flex-1" />
                  )}

                  {/* 2) 진행 — 진행률과 턴은 같은 축이라 한 줄에 모은다(종전엔 턴만 카드 상단에 떨어져 있었다). */}
                  <div className="mb-3">
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-faint">{t("progressLabel")}</span>
                      <span className="flex items-baseline gap-2 font-mono">
                        <span className="text-fg-2">{pct}%</span>
                        <span className="text-faint">
                          {t("turnShort", { current: task.currentTurn, max: task.maxTurns })}
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-pill bg-surface-3">
                      <div className="h-full rounded-pill bg-accent transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  {/* 3) 측정값 — 시작·소요를 각각 독립 항목으로 세우고 모델·토큰과 함께 2×2 로 정렬한다.
                      라벨이 값의 뜻을 말하므로 종전의 Clock/Cpu 아이콘은 뺐다(중복). */}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-xs">
                    {(() => {
                      const started = formatStartedAt(task.startedAt, locale);
                      return (
                        <div className="flex items-baseline justify-between gap-2" title={started?.full}>
                          <dt className="text-faint">{t("startedLabel")}</dt>
                          <dd className="truncate font-mono text-fg-2">{started?.short ?? "—"}</dd>
                        </div>
                      );
                    })()}
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-faint">{t("modelLabel")}</dt>
                      <dd className="truncate text-fg-2">{task.model}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <dt className="text-faint">{t("elapsedLabel")}</dt>
                      <dd className="truncate font-mono text-fg-2">{task.elapsed}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-2" title={t("tokensUsedHint")}>
                      <dt className="text-faint">{t("tokensLabel")}</dt>
                      <dd className="truncate font-mono tabular-nums text-fg-2">
                        {typeof task.totalTokens === "number" && task.totalTokens > 0
                          ? task.totalTokens.toLocaleString()
                          : "—"}
                      </dd>
                    </div>
                  </dl>

                  {/* 4) 액션 — 종전엔 메타와 한 줄을 다퉈 좁은 카드에서 넘쳤다. 별도 줄로 내리고 우측 정렬. */}
                  <div className="mt-3 flex items-center justify-end gap-1">
                    <div className="flex items-center gap-1">
                      {/* 산출물 미리보기 — 상세 모달·타임라인을 거치지 않고 결과만 바로 본다.
                          종료된 작업에만 노출(실행 중엔 산출물이 아직 없다). */}
                      {(task.rawStatus === "completed" || task.rawStatus === "failed" || task.rawStatus === "cancelled") && (
                        <button
                          onClick={() => setPreviewTaskId(task.id)}
                          title={t("previewTitle")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-accent-soft hover:text-accent">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Resume (failed + resumable) */}
                      {task.rawStatus === "failed" && task.resumable && (
                        <button
                          onClick={() => void handleResume(task)}
                          disabled={isActing}
                          title={t("resumeTitle")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-accent-soft hover:text-accent disabled:opacity-40">
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Retry from scratch (failed/cancelled) — resume 과 별개로 처음부터 재실행 */}
                      {(task.rawStatus === "failed" || task.rawStatus === "cancelled") && (
                        <button
                          onClick={() => void handleRetry(task)}
                          disabled={isActing}
                          title={t("retryTitle")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-accent-soft hover:text-accent disabled:opacity-40">
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Cancel (running/pending) */}
                      {(task.status === "running" || task.rawStatus === "pending") && (
                        <button
                          onClick={() => void handleCancel(task)}
                          disabled={isActing}
                          title={t("cancelTitle")}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* Delete */}
                      <button
                        onClick={() => void handleDelete(task)}
                        disabled={isActing}
                        title={t("deleteTitle")}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger disabled:opacity-40">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* 작업 상세 모달 */}
      {detailTaskId && (
        <Modal open={!!detailTaskId} onClose={() => setDetailTaskId(null)} title={t("modalTitle")}>
          <TaskDetailModal taskId={detailTaskId} />
        </Modal>
      )}
      {previewTaskId && (
        <PreviewModal taskId={previewTaskId} onClose={() => setPreviewTaskId(null)} />
      )}
    </>
  );
}
