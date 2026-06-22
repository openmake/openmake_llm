"use client";

import { useEffect, useRef, useState } from "react";
import {
  Telescope,
  Plus,
  Search,
  CircleCheck,
  LoaderCircle,
  Circle,
  FileText,
  Link,
  TriangleAlert,
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

const STAGE_TONE: Record<StageStatus, "success" | "accent" | "neutral"> = {
  done: "success",
  running: "accent",
  pending: "neutral",
};

const STAGE_LABEL: Record<StageStatus, string> = {
  done: "완료",
  running: "진행중",
  pending: "대기",
};

/** depth 백엔드 enum(basic/deep/comprehensive) ↔ UI 라벨. */
const DEPTH_OPTIONS: { value: "basic" | "deep" | "comprehensive"; label: string }[] = [
  { value: "basic", label: "빠른 검색" },
  { value: "deep", label: "표준 (심층)" },
  { value: "comprehensive", label: "종합 (최대)" },
];

const TERMINAL: ApiResearchStatus[] = ["completed", "failed", "cancelled"];

export default function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [depth, setDepth] = useState<"basic" | "deep" | "comprehensive">("deep");
  const [busy, setBusy] = useState(false);
  // 최신 세션이 있으면 그것으로 진행/소스/메트릭 표시. 없거나 실패 시 목업 폴백.
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [sources, setSources] = useState<Source[]>(SOURCES);
  const [metrics, setMetrics] = useState<Metric[]>(METRICS);
  const [status, setStatus] = useState<ApiResearchStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);

  // 세션 → 화면 상태 반영 (초기 로드 + 폴링 공용).
  const applySession = (s: ApiResearchSession) => {
    const srcUrls = s.sources ?? [];
    setStages(deriveStages(s));
    setSources(srcUrls.map(urlToSource));
    setStatus(s.status);
    setMetrics([
      { label: "분석 소스", value: String(srcUrls.length) },
      { label: "주요 발견", value: String(s.key_findings?.length ?? 0) },
      { label: "진행률", value: `${Math.round(s.progress)}%` },
      { label: "깊이", value: s.depth },
    ]);
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
          pollRef.current = setTimeout(() => poll(sid), 2500);
        }
      }
    } catch {
      /* 일시 실패 — 다음 틱에 재시도 */
      if (aliveRef.current) pollRef.current = setTimeout(() => poll(sid), 4000);
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        const res = await ApiClient.get<ResearchSessionsResponse>(
          "/api/research/sessions?limit=20",
        );
        const latest = res?.data?.sessions?.[0];
        if (!latest || !aliveRef.current) return;
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

  // 리서치 시작 — 세션 생성 → 비동기 실행 → 폴링.
  const startResearch = async () => {
    const t = topic.trim();
    if (!t || busy || isRunning) return;
    setBusy(true);
    try {
      const created = await ApiClient.post<ApiSuccess<{ session: ApiResearchSession }>>(
        "/api/research/sessions",
        { topic: t, depth },
      );
      const sid = created?.data?.session?.id;
      if (!sid) throw new Error("세션 생성 실패");
      await ApiClient.post(`/api/research/sessions/${sid}/execute`, {});
      setStatus("running");
      setStages(STAGES.map((s, i) => ({ ...s, status: i === 0 ? "running" : "pending" })));
      if (pollRef.current) clearTimeout(pollRef.current);
      poll(sid);
    } catch {
      /* 실패 — 상태 유지 */
    } finally {
      setBusy(false);
    }
  };

  // 새 리서치 — 폼/화면 초기화.
  const newResearch = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    setTopic("");
    setStatus(null);
    setStages(STAGES);
    setSources(SOURCES);
    setMetrics(METRICS);
  };

  return (
    <>
      <PageHeader
        title="딥 리서치"
        description="자율 다단계 리서치 에이전트가 질문 분해부터 인용 보고서까지 합성합니다."
        actions={
          <Button size="sm" onClick={newResearch}>
            <Plus className="h-4 w-4" />새 리서치
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 새 리서치 입력 */}
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[240px] flex-[3]">
              <label className="mb-2 block text-xs font-medium text-fg-2">
                연구 주제
              </label>
              <div className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3">
                <Search className="h-4 w-4 text-faint" />
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") startResearch();
                  }}
                  placeholder="연구하고 싶은 주제를 입력하세요..."
                  className="h-9 w-full bg-transparent text-sm text-fg outline-none placeholder:text-faint"
                />
              </div>
            </div>
            <div className="min-w-[120px] flex-1">
              <label className="mb-2 block text-xs font-medium text-fg-2">
                깊이
              </label>
              <select
                value={depth}
                onChange={(e) => setDepth(e.target.value as typeof depth)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-fg outline-none"
              >
                {DEPTH_OPTIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <Button size="md" disabled={!topic.trim() || busy || isRunning} onClick={startResearch}>
              <Telescope className="h-4 w-4" />
              {busy ? "시작 중…" : isRunning ? "진행 중…" : "리서치 시작"}
            </Button>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          {/* 좌측: 진행 단계 + 소스 */}
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>리서치 진행</CardTitle>
                {status && !isRunning ? (
                  <Badge tone={status === "completed" ? "success" : "neutral"}>
                    {status === "completed" ? "완료" : "종료"}
                  </Badge>
                ) : (
                  <Badge tone="accent">
                    <LoaderCircle className="h-3 w-3 animate-spin" />
                    진행중
                  </Badge>
                )}
              </CardHeader>
              <CardContent>
                <ol className="relative space-y-5 border-l border-border pl-6">
                  {stages.map((stage) => {
                    const Icon = STAGE_ICON[stage.status];
                    return (
                      <li key={stage.key} className="relative">
                        <span
                          className={cn(
                            "absolute -left-[31px] grid h-5 w-5 place-items-center rounded-full bg-surface",
                            stage.status === "done" && "text-success",
                            stage.status === "running" && "text-accent",
                            stage.status === "pending" && "text-faint",
                          )}
                        >
                          <Icon
                            className={cn(
                              "h-4 w-4",
                              stage.status === "running" && "animate-spin",
                            )}
                          />
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-fg">
                            {stage.label}
                          </span>
                          <Badge tone={STAGE_TONE[stage.status]}>
                            {STAGE_LABEL[stage.status]}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">{stage.desc}</p>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex items-center justify-between">
                <CardTitle>수집 소스</CardTitle>
                <span className="font-mono text-xs text-faint">
                  {sources.length}건
                </span>
              </CardHeader>
              <CardContent className="space-y-2">
                {sources.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-start gap-3 rounded-md border border-border bg-surface-2 px-3 py-2.5"
                  >
                    <Link className="mt-0.5 h-4 w-4 flex-shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-fg">{s.title}</p>
                      <p className="truncate font-mono text-xs text-faint">
                        {s.domain}
                      </p>
                    </div>
                    {s.verified ? (
                      <Badge tone="success">검증됨</Badge>
                    ) : (
                      <Badge tone="warn">미검증</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* 우측: 메트릭 */}
          <div className="space-y-3">
            <Card>
              <CardHeader>
                <CardTitle>메트릭</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {metrics.map((m) => (
                  <div
                    key={m.label}
                    className="flex items-center justify-between"
                  >
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      {m.tone === "warn" && (
                        <TriangleAlert className="h-3.5 w-3.5 text-warn" />
                      )}
                      {m.label}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-sm font-semibold",
                        m.tone === "warn" ? "text-warn" : "text-fg",
                      )}
                    >
                      {m.value}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted">
                <FileText className="h-4 w-4 text-faint" />
                보고서는 합성 완료 후 표시됩니다.
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
