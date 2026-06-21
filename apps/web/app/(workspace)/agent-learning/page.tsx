"use client";

import { useEffect, useState } from "react";
import { GraduationCap, ThumbsUp, ThumbsDown } from "lucide-react";
import {
  Badge,
  PageHeader,
  StatCard,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 백엔드 응답 타입 (GET /api/agents/feedback/stats) ─────── */
interface ApiFeedbackStats {
  totalFeedbacks: number;
  avgRating: number;
  topAgents?: { agentId: string; score: number }[];
  worstAgents?: { agentId: string; score: number }[];
}

/* ── 타입 ────────────────────────────────────────────────── */
type LearningStatus = "applied" | "reviewing" | "pending";

interface LearningItem {
  id: number;
  topic: string;
  positive: number;
  negative: number;
  status: LearningStatus;
}

/* ── 목업 데이터 ──────────────────────────────────────────
 * "수집 피드백" StatCard 는 GET /api/agents/feedback/stats 의 totalFeedbacks
 * 로 실연동. "반영 개선"·"대기" 는 백엔드에 해당 집계가 없어 목업 유지.
 * 하단 "학습 항목" 리스트(topic+👍/👎+상태)도 백엔드에 동등 엔드포인트가
 * 없어 목업 유지. (stats 는 topAgents/worstAgents 만 제공 — 형태 불일치)
 */
const SUMMARY = {
  collected: "1,284",
  applied: "37",
  pending: "12",
};

const ITEMS: LearningItem[] = [
  {
    id: 1,
    topic: "코드 리뷰 응답의 근거 인용 강화",
    positive: 142,
    negative: 18,
    status: "applied",
  },
  {
    id: 2,
    topic: "한국어 존댓말 일관성 유지",
    positive: 98,
    negative: 7,
    status: "applied",
  },
  {
    id: 3,
    topic: "딥 리서치 출처 신뢰도 표기",
    positive: 64,
    negative: 21,
    status: "reviewing",
  },
  {
    id: 4,
    topic: "장문 요약 시 핵심 누락 감소",
    positive: 51,
    negative: 33,
    status: "reviewing",
  },
  {
    id: 5,
    topic: "도구 호출 실패 시 사용자 안내 개선",
    positive: 29,
    negative: 44,
    status: "pending",
  },
  {
    id: 6,
    topic: "수치 계산 검산 단계 추가",
    positive: 18,
    negative: 12,
    status: "pending",
  },
];

const STATUS_META: Record<
  LearningStatus,
  { label: string; tone: "success" | "warn" | "neutral" }
> = {
  applied: { label: "반영됨", tone: "success" },
  reviewing: { label: "검토 중", tone: "warn" },
  pending: { label: "대기", tone: "neutral" },
};

export default function AgentLearningPage() {
  const [items] = useState<LearningItem[]>(ITEMS);
  const [collected, setCollected] = useState<string>(SUMMARY.collected);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<ApiEnvelope<ApiFeedbackStats>>(
          "/api/agents/feedback/stats",
        );
        if (cancelled) return;
        const stats = res?.data;
        if (stats && typeof stats.totalFeedbacks === "number") {
          setCollected(stats.totalFeedbacks.toLocaleString("ko-KR"));
        }
      } catch {
        // 401·실패 → 목업 값 유지 (데모)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="에이전트 학습"
        description="사용자 피드백을 기반으로 한 에이전트 개선 현황을 추적합니다."
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="수집 피드백"
            value={collected}
            delta="+126 이번 주"
            deltaTone="success"
          />
          <StatCard label="반영 개선" value={SUMMARY.applied} />
          <StatCard label="대기" value={SUMMARY.pending} />
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>학습 항목</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {items.length === 0 ? (
              <div className="py-12 text-center text-muted">
                수집된 학습 항목이 없습니다.
              </div>
            ) : (
              items.map((it) => {
                const meta = STATUS_META[it.status];
                const total = it.positive + it.negative;
                const positivePct = total ? (it.positive / total) * 100 : 0;
                return (
                  <div
                    key={it.id}
                    className="flex flex-col gap-3 px-5 py-4 transition hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-accent">
                        <GraduationCap className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-fg">
                          {it.topic}
                        </p>
                        <div className="mt-1 flex items-center gap-3 text-xs">
                          <span className="inline-flex items-center gap-1 text-success">
                            <ThumbsUp className="h-3 w-3" />
                            {it.positive}
                          </span>
                          <span className="inline-flex items-center gap-1 text-danger">
                            <ThumbsDown className="h-3 w-3" />
                            {it.negative}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 sm:w-56 sm:shrink-0 sm:justify-end">
                      <div className="hidden h-2 flex-1 overflow-hidden rounded-pill bg-surface-2 sm:block">
                        <div
                          className="h-full rounded-pill bg-accent"
                          style={{ width: `${positivePct}%` }}
                        />
                      </div>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
