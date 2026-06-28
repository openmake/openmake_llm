"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  LoaderCircle,
  Circle,
  FileText,
  Link,
  TriangleAlert,
  ChevronDown,
} from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { CLIENT_TIMING } from "@/lib/config";

/* ── 타입 ────────────────────────────────────────────────── */
type StageStatus = "done" | "running" | "pending";

interface Stage {
  key: string;
  label: string;
  desc: string;
  status: StageStatus;
}

interface Source {
  id: string;
  title: string;
  domain: string;
  verified: boolean;
}

interface Metric {
  label: string;
  value: string;
  tone?: "default" | "warn";
}

/* ── 백엔드 응답 타입 (GET /api/research/sessions → res.data.sessions) ── */
type ApiResearchStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

interface ApiResearchSession {
  id: string;
  topic: string;
  status: ApiResearchStatus;
  depth: string;
  progress: number;
  summary?: string;
  key_findings?: string[];
  sources?: string[];
  created_at?: string;
}

type ResearchSessionsResponse = ApiSuccess<{
  sessions: ApiResearchSession[];
  total: number;
}>;

/** progress(0~100) 기준으로 4단계 파이프라인 상태를 파생. completed 면 전부 done. */
function deriveStages(session: ApiResearchSession): Stage[] {
  const base: Omit<Stage, "status">[] = [
    { key: "decompose", label: "질문 분해", desc: "핵심 질문을 검증 가능한 하위 질문으로 분해" },
    { key: "collect", label: "소스 수집", desc: "웹 검색 fan-out 및 신뢰도 기반 소스 선별" },
    { key: "verify", label: "교차 검증", desc: "주장별 적대적 검증 및 상충 탐지" },
    { key: "synthesize", label: "보고서 합성", desc: "인용 포함 최종 보고서 생성" },
  ];
  if (session.status === "completed") {
    return base.map((s) => ({ ...s, status: "done" as StageStatus }));
  }
  if (session.status === "pending") {
    return base.map((s) => ({ ...s, status: "pending" as StageStatus }));
  }
  // running/failed/cancelled: progress 로 현재 단계 추정
  const activeIdx = Math.min(
    base.length - 1,
    Math.floor((Math.max(0, Math.min(100, session.progress)) / 100) * base.length),
  );
  return base.map((s, i) => ({
    ...s,
    status: i < activeIdx ? "done" : i === activeIdx ? "running" : "pending",
  }));
}

function urlToSource(raw: string, idx: number): Source {
  let domain = raw;
  try {
    domain = new URL(raw).hostname;
  } catch {
    /* URL 이 아니면 원문 사용 */
  }
  return { id: String(idx), title: raw, domain, verified: true };
}

/* ── 목업 데이터 — 미인증/네트워크 실패/세션 없음 시 폴백 ─────── */
const STAGES: Stage[] = [
  {
    key: "decompose",
    label: "질문 분해",
    desc: "핵심 질문을 검증 가능한 하위 질문으로 분해",
    status: "done",
  },
  {
    key: "collect",
    label: "소스 수집",
    desc: "웹 검색 fan-out 및 신뢰도 기반 소스 선별",
    status: "done",
  },
  {
    key: "verify",
    label: "교차 검증",
    desc: "주장별 적대적 검증 및 상충 탐지",
    status: "running",
  },
  {
    key: "synthesize",
    label: "보고서 합성",
    desc: "인용 포함 최종 보고서 생성",
    status: "pending",
  },
];

const SOURCES: Source[] = [
  {
    id: "1",
    title: "2026 AI 에이전트 시장 동향 보고서",
    domain: "research.example.com",
    verified: true,
  },
  {
    id: "2",
    title: "멀티 에이전트 오케스트레이션 아키텍처 분석",
    domain: "arxiv.org",
    verified: true,
  },
  {
    id: "3",
    title: "엔터프라이즈 LLM 도입 사례 연구",
    domain: "techblog.example.io",
    verified: true,
  },
  {
    id: "4",
    title: "자율 에이전트 안전성 가이드라인",
    domain: "safety.example.org",
    verified: false,
  },
  {
    id: "5",
    title: "RAG vs 장기 컨텍스트 비교 벤치마크",
    domain: "benchmark.example.dev",
    verified: true,
  },
];

const METRICS: Metric[] = [
  { label: "분석 소스", value: "5" },
  { label: "검증 주장", value: "23" },
  { label: "상충 발견", value: "2", tone: "warn" },
  { label: "사용 토큰", value: "48.2K" },
  { label: "경과 시간", value: "3분 12초" },
];

const STAGE_ICON: Record<StageStatus, typeof Circle> = {
  done: CircleCheck,
  running: LoaderCircle,
  pending: Circle,
};


const TERMINAL: ApiResearchStatus[] = ["completed", "failed", "cancelled"];

const STATUS_LABEL: Record<ApiResearchStatus, string> = {
  pending: "대기",
  running: "진행중",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
};
const STATUS_TONE: Record<ApiResearchStatus, "success" | "accent" | "neutral" | "warn"> = {
  pending: "neutral",
  running: "accent",
  completed: "success",
  failed: "warn",
  cancelled: "neutral",
};

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function ResearchPage() {
  const router = useRouter();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // 최신 세션이 있으면 그것으로 진행/소스/메트릭 표시. 없거나 실패 시 목업 폴백.
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [sources, setSources] = useState<Source[]>(SOURCES);
  const [metrics, setMetrics] = useState<Metric[]>(METRICS);
  const [status, setStatus] = useState<ApiResearchStatus | null>(null);
  const [sessionList, setSessionList] = useState<ApiResearchSession[]>([]);
  const [activeSession, setActiveSession] = useState<ApiResearchSession | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  // 세션 → 화면 상태 반영 (초기 로드 + 폴링 + 목록 선택 공용).
  const applySession = (s: ApiResearchSession) => {
    const srcUrls = s.sources ?? [];
    setStages(deriveStages(s));
    setSources(srcUrls.map(urlToSource));
    setStatus(s.status);
    setActiveSession(s);
    setSessionList((prev) => prev.map((p) => (p.id === s.id ? { ...p, ...s } : p)));
    setMetrics([
      { label: "분석 소스", value: String(srcUrls.length) },
      { label: "주요 발견", value: String(s.key_findings?.length ?? 0) },
      { label: "진행률", value: `${Math.round(s.progress)}%` },
      { label: "깊이", value: s.depth },
    ]);
  };

  // 지난 리서치 목록에서 선택 → 해당 세션 로드 (진행 중이면 폴링 재개).
  const selectSession = (s: ApiResearchSession) => {
    if (pollRef.current) clearTimeout(pollRef.current);
    applySession(s);
    if (!TERMINAL.includes(s.status)) poll(s.id);
  };

  // 진행 중인 세션을 폴링 — 완료/실패/취소면 중단.
  const poll = async (sid: string) => {
    if (!aliveRef.current) return;
    try {
      const res = await ApiClient.get<ApiSuccess<{ session: ApiResearchSession }>>(
        `/api/research/sessions/${sid}`,
      );
      const s = res?.data?.session;
      if (s && aliveRef.current) {
        applySession(s);
        if (!TERMINAL.includes(s.status)) {
          pollRef.current = setTimeout(() => poll(sid), CLIENT_TIMING.RESEARCH_POLL_MS);
        }
      }
    } catch {
      /* 일시 실패 — 다음 틱에 재시도 */
      if (aliveRef.current) pollRef.current = setTimeout(() => poll(sid), CLIENT_TIMING.RESEARCH_POLL_RETRY_MS);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        const res = await ApiClient.get<ResearchSessionsResponse>(
          "/api/research/sessions?limit=20",
        );
        const list = res?.data?.sessions ?? [];
        if (!aliveRef.current) return;
        setSessionList(list);
        const latest = list[0];
        if (!latest) return;
        applySession(latest);
        if (!TERMINAL.includes(latest.status)) poll(latest.id); // 진행 중이면 이어서 폴링
      } catch {
        // 401·네트워크 실패: 목업 폴백 유지
      }
    })();
    return () => {
      aliveRef.current = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isRunning = status === "running" || status === "pending";

  return (
    <>
      <PageHeader
        title="딥 리서치 히스토리"
        description="지난 리서치 결과를 조회합니다. 실행은 채팅의 딥 리서치 모드에서 진행됩니다."
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 실행 안내 배너 — 생성/실행은 채팅 인라인으로 일원화 */}
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-muted">
            딥 리서치는 채팅 입력창의{" "}
            <span className="font-medium text-fg-2">딥 리서치</span> 모드로
            실행하세요. 이 페이지에서는 지난 리서치 결과를 조회합니다.
          </p>
          <Button size="sm" variant="outline" onClick={() => router.push("/")}>
            채팅으로 이동
          </Button>
        </Card>

        {/* 보고서 중심 레이아웃: 좌측 지난 리서치 레일 + 메인(진행 stepper · 메트릭 · 보고서 · 소스) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          {/* 좌측 레일: 지난 리서치 (min-w-0 로 긴 주제 truncate) */}
          <div className="min-w-0">
            <Card className="lg:sticky lg:top-0">
              <CardHeader className="flex items-center justify-between">
                <CardTitle>지난 리서치</CardTitle>
                <span className="font-mono text-xs text-faint">{sessionList.length}</span>
              </CardHeader>
              <CardContent className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                {sessionList.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted">아직 리서치가 없습니다.</p>
                ) : (
                  sessionList.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => selectSession(s)}
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition",
                        s.id === activeSession?.id
                          ? "border-accent bg-accent-soft"
                          : "border-border bg-surface-2 hover:bg-surface-3",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{s.topic}</span>
                        <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                        <span>{fmtDate(s.created_at)}</span>
                        <span>·</span>
                        <span>{Math.round(s.progress)}%</span>
                      </div>
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* 메인: 진행 stepper · 메트릭 · 보고서 · 수집 소스 */}
          <div className="min-w-0 space-y-5">
            {/* 진행 단계 — 가로 compact stepper */}
            <Card className="p-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
                {stages.map((stage, i) => {
                  const Icon = STAGE_ICON[stage.status];
                  return (
                    <div key={stage.key} className="flex items-center gap-2">
                      <span
                        className={cn(
                          "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                          stage.status === "done" && "bg-success-soft text-success",
                          stage.status === "running" && "bg-accent-soft text-accent",
                          stage.status === "pending" && "bg-surface-2 text-faint",
                        )}
                        title={stage.desc}
                      >
                        <Icon className={cn("h-3.5 w-3.5", stage.status === "running" && "animate-spin")} />
                        {stage.label}
                      </span>
                      {i < stages.length - 1 && (
                        <span className="hidden h-px w-5 bg-border sm:block" />
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* 메트릭 — 가로 인라인 stat strip */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {metrics.map((m) => (
                <Card key={m.label} className="p-3">
                  <p className="flex items-center gap-1 text-[11px] text-muted">
                    {m.tone === "warn" && <TriangleAlert className="h-3 w-3 text-warn" />}
                    {m.label}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 font-mono text-lg font-semibold",
                      m.tone === "warn" ? "text-warn" : "text-fg",
                    )}
                  >
                    {m.value}
                  </p>
                </Card>
              ))}
            </div>

            {/* 보고서 — 메인 산출물, 넓게 */}
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>보고서</CardTitle>
                {activeSession && (
                  <Badge tone={STATUS_TONE[activeSession.status]}>
                    {STATUS_LABEL[activeSession.status]}
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                {activeSession?.summary || (activeSession?.key_findings?.length ?? 0) > 0 ? (
                  <div className="space-y-4">
                    {activeSession?.summary && (
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-2">
                        {activeSession.summary}
                      </p>
                    )}
                    {(activeSession?.key_findings?.length ?? 0) > 0 && (
                      <div className="space-y-2 border-t border-border pt-3">
                        <p className="text-xs font-semibold text-fg-2">주요 발견</p>
                        <ul className="space-y-1.5">
                          {activeSession!.key_findings!.map((f, i) => (
                            <li key={i} className="flex gap-2 text-sm text-fg-2">
                              <CircleCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-success" />
                              <span className="break-words">{f}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-6 text-sm text-muted">
                    <FileText className="h-4 w-4 text-faint" />
                    {isRunning ? "리서치 진행 중 — 합성 완료 후 보고서가 표시됩니다." : "보고서는 합성 완료 후 표시됩니다."}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 수집 소스 — 접기 (기본 접힘, 길어지지 않게) */}
            <Card>
              <button
                type="button"
                onClick={() => setSourcesOpen((v) => !v)}
                className="flex w-full items-center justify-between px-5 py-4"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-fg">
                  수집 소스
                  <span className="font-mono text-xs text-faint">{sources.length}건</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-faint transition-transform",
                    sourcesOpen && "rotate-180",
                  )}
                />
              </button>
              {sourcesOpen && (
                <CardContent className="max-h-[50vh] space-y-2 overflow-y-auto pt-0">
                  {sources.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-start gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5"
                    >
                      <Link className="mt-0.5 h-4 w-4 flex-shrink-0 text-faint" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-fg">{s.title}</p>
                        <p className="truncate font-mono text-xs text-faint">{s.domain}</p>
                      </div>
                      {s.verified ? (
                        <Badge tone="success">검증됨</Badge>
                      ) : (
                        <Badge tone="warn">미검증</Badge>
                      )}
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
