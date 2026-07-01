"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toBcp47 } from "@/i18n/config";
import { GraduationCap, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
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

/* ── 백엔드 응답 타입 ────────────────────────────────────── */
interface ApiFeedbackStats {
  totalFeedbacks: number;
  avgRating: number;
  topAgents?: { agentId: string; score: number }[];
  worstAgents?: { agentId: string; score: number }[];
}

interface ApiQualityScore {
  agentId: string;
  score?: number;
  totalFeedbacks?: number;
  avgRating?: number;
  [key: string]: unknown;
}

interface ApiFailurePattern {
  pattern?: string;
  count?: number;
  [key: string]: unknown;
}

interface ApiImprovement {
  suggestion?: string;
  priority?: string;
  [key: string]: unknown;
}

interface ApiSystemAgent {
  id: string;
  name: string;
  emoji?: string;
  category?: string;
}

/* ── 타입 ────────────────────────────────────────────────── */
type LearningStatus = "applied" | "reviewing" | "pending";

interface LearningItem {
  id: number;
  topicKey: string;
  positive: number;
  negative: number;
  status: LearningStatus;
}

/* ── 목업 데이터 ──────────────────────────────────────────── */
const ITEMS_FALLBACK: LearningItem[] = [
  { id: 1, topicKey: "topics.codeReviewCitation", positive: 142, negative: 18, status: "applied" },
  { id: 2, topicKey: "topics.koreanHonorific", positive: 98, negative: 7, status: "applied" },
  { id: 3, topicKey: "topics.researchSourceReliability", positive: 64, negative: 21, status: "reviewing" },
  { id: 4, topicKey: "topics.longSummaryOmission", positive: 51, negative: 33, status: "reviewing" },
  { id: 5, topicKey: "topics.toolFailureGuidance", positive: 29, negative: 44, status: "pending" },
  { id: 6, topicKey: "topics.calcVerification", positive: 18, negative: 12, status: "pending" },
];

const STATUS_META: Record<LearningStatus, { labelKey: string; tone: "success" | "warn" | "neutral" }> = {
  applied: { labelKey: "status.applied", tone: "success" },
  reviewing: { labelKey: "status.reviewing", tone: "warn" },
  pending: { labelKey: "status.pending", tone: "neutral" },
};

/* ── 에이전트별 품질 패널 ─────────────────────────────────── */
function AgentDetailPanel({ agentId }: { agentId: string }) {
  const t = useTranslations("agentLearning");
  const [quality, setQuality] = useState<ApiQualityScore | null>(null);
  const [failures, setFailures] = useState<ApiFailurePattern[]>([]);
  const [improvements, setImprovements] = useState<ApiImprovement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const [qRes, fRes, iRes] = await Promise.allSettled([
          ApiClient.get<ApiEnvelope<ApiQualityScore>>(`/api/agents/${agentId}/quality`),
          ApiClient.get<ApiEnvelope<ApiFailurePattern[]>>(`/api/agents/${agentId}/failures`),
          ApiClient.get<ApiEnvelope<ApiImprovement[]>>(`/api/agents/${agentId}/improvements`),
        ]);
        if (cancelled) return;
        if (qRes.status === "fulfilled") setQuality(qRes.value?.data ?? null);
        if (fRes.status === "fulfilled") {
          const d = fRes.value?.data;
          setFailures(Array.isArray(d) ? d : []);
        }
        if (iRes.status === "fulfilled") {
          const d = iRes.value?.data;
          setImprovements(Array.isArray(d) ? d : []);
        }
      } catch {
        // 실패 시 빈 상태 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("loadingAgent")}
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* 품질 점수 */}
      <Card>
        <CardHeader><CardTitle>{t("qualityScore")}</CardTitle></CardHeader>
        <CardContent>
          {quality ? (
            <div className="space-y-2">
              {typeof quality.score === "number" && (
                <div className="flex items-end gap-1">
                  <span className="text-3xl font-bold text-fg">{quality.score.toFixed(1)}</span>
                  <span className="mb-1 text-xs text-muted">/10</span>
                </div>
              )}
              {typeof quality.totalFeedbacks === "number" && (
                <p className="text-xs text-muted">{t("totalFeedbackCount", { count: quality.totalFeedbacks })}</p>
              )}
              {typeof quality.avgRating === "number" && (
                <p className="text-xs text-muted">{t("avgRatingValue", { rating: quality.avgRating.toFixed(2) })}</p>
              )}
              {typeof quality.score !== "number" && typeof quality.totalFeedbacks !== "number" && (
                <p className="text-xs text-muted">{t("noQualityData")}</p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">{t("noData")}</p>
          )}
        </CardContent>
      </Card>

      {/* 실패 패턴 */}
      <Card>
        <CardHeader><CardTitle>{t("failurePatterns")}</CardTitle></CardHeader>
        <CardContent>
          {failures.length === 0 ? (
            <p className="text-xs text-muted">{t("noFailurePatterns")}</p>
          ) : (
            <ul className="space-y-2">
              {failures.slice(0, 4).map((f, i) => (
                <li key={i} className="text-xs text-fg-2">
                  {f.pattern ? (
                    <span>{f.pattern}{f.count != null && <span className="ml-1 text-faint">{t("patternCount", { count: f.count })}</span>}</span>
                  ) : (
                    <span className="text-faint font-mono">{JSON.stringify(f)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 개선 제안 */}
      <Card>
        <CardHeader><CardTitle>{t("improvements")}</CardTitle></CardHeader>
        <CardContent>
          {improvements.length === 0 ? (
            <p className="text-xs text-muted">{t("noImprovements")}</p>
          ) : (
            <ul className="space-y-2">
              {improvements.slice(0, 4).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  {item.priority && (
                    <Badge tone={item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "neutral"}>
                      {item.priority}
                    </Badge>
                  )}
                  <span className="text-fg-2">{item.suggestion ?? JSON.stringify(item)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AgentLearningPage() {
  const t = useTranslations("agentLearning");
  const locale = toBcp47(useLocale());
  const [items] = useState<LearningItem[]>(ITEMS_FALLBACK);
  const [collected, setCollected] = useState("1,284");
  const [agents, setAgents] = useState<ApiSystemAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 피드백 통계
        const statsRes = await ApiClient.get<ApiEnvelope<ApiFeedbackStats>>("/api/agents/feedback/stats");
        if (cancelled) return;
        const stats = statsRes?.data;
        if (stats && typeof stats.totalFeedbacks === "number") {
          setCollected(stats.totalFeedbacks.toLocaleString(locale));
        }
      } catch {
        // 목업 값 유지
      }

      try {
        // 시스템 에이전트 목록 (드롭다운용)
        const agentsRes = await ApiClient.get<ApiEnvelope<{ agents: ApiSystemAgent[] }>>("/api/agents");
        if (cancelled) return;
        const list = agentsRes?.data?.agents ?? [];
        setAgents(list);
        if (list.length > 0 && !selectedAgentId) {
          setSelectedAgentId(list[0].id);
        }
      } catch {
        // 드롭다운 없이 진행
      }
    })();
    return () => { cancelled = true; };
  }, [locale]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 요약 통계 */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label={t("collectedFeedback")} value={collected} delta={t("collectedFeedbackDelta")} deltaTone="success" />
          <StatCard label={t("appliedImprovements")} value="37" />
          <StatCard label={t("pendingLabel")} value="12" />
        </div>

        {/* 에이전트별 품질 패널 */}
        {agents.length > 0 && (
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-3">
              <h2 className="text-sm font-semibold text-fg">{t("agentDetailAnalysis")}</h2>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-fg outline-none focus:border-accent"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji ? `${a.emoji} ` : ""}{a.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedAgentId && <AgentDetailPanel agentId={selectedAgentId} />}
          </div>
        )}

        {/* 학습 항목 리스트 */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("learningItems")}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {items.length === 0 ? (
              <div className="py-12 text-center text-muted">
                {t("emptyLearningItems")}
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
                        <p className="truncate text-sm font-medium text-fg">{t(it.topicKey)}</p>
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
                      <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
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
