"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Lightbulb, RefreshCw, Loader2, Check, X } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * F2 자가개선 — 에이전트 프롬프트 개선 제안 검토/승인 (admin 전용).
 *
 * 백엔드 `/api/admin/agent-suggestions` 는 2026-06-18 에 추가됐지만 승인 화면이 없어
 * 제안이 영구 pending 이었다(승인된 제안만 시스템 프롬프트에 주입되므로 루프가 닫히지 않음).
 */

/* ── 타입 (백엔드 PromptSuggestionRow, camelCase 직렬화) ── */
type SuggestionStatus = "pending" | "approved" | "rejected";

interface PromptSuggestion {
  id: string;
  agentId: string;
  suggestion: string;
  sourcePatterns: string | null;
  qualityScore: number | null;
  status: SuggestionStatus;
  createdAt: string;
}
interface SuggestionsPayload {
  suggestions: PromptSuggestion[];
  total: number;
}

type FilterId = SuggestionStatus | "all";
const FILTERS: FilterId[] = ["pending", "approved", "rejected", "all"];

const STATUS_TONE: Record<SuggestionStatus, "success" | "danger" | "warn"> = {
  approved: "success",
  rejected: "danger",
  pending: "warn",
};

function fmtDateTime(s?: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function AdminAgentSuggestionsPage() {
  const t = useTranslations("adminSuggestions");
  const [payload, setPayload] = useState<SuggestionsPayload | null>(null);
  const [filter, setFilter] = useState<FilterId>("pending");
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status: FilterId) => {
    setLoading(true);
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<SuggestionsPayload>>(
        `/api/admin/agent-suggestions?status=${status}`,
      );
      setPayload(r?.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load(filter));
  }, [load, filter]);

  async function decide(id: string, decision: "approve" | "reject") {
    setActing((prev) => ({ ...prev, [id]: true }));
    setError(null);
    try {
      await ApiClient.post(`/api/admin/agent-suggestions/${id}/${decision}`, {});
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionError"));
    } finally {
      setActing((prev) => ({ ...prev, [id]: false }));
    }
  }

  const suggestions = payload?.suggestions ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <AdminTabs />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4" aria-hidden />
            {t("listTitle", { count: payload?.total ?? 0 })}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-pill border border-border bg-surface-2 p-1">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-pill px-2.5 py-1 text-xs transition",
                    filter === f ? "bg-accent-soft text-accent" : "text-muted hover:text-fg",
                  )}
                >
                  {t(`filter.${f}`)}
                </button>
              ))}
            </div>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(filter)}>
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                : <RefreshCw className="h-4 w-4" aria-hidden />}
              {t("refresh")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted">{t("note")}</p>
          {suggestions.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted">{t("empty")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("cols.agent")}</Th>
                  <Th>{t("cols.suggestion")}</Th>
                  <Th className="text-right">{t("cols.quality")}</Th>
                  <Th>{t("cols.status")}</Th>
                  <Th>{t("cols.createdAt")}</Th>
                  <Th>{t("cols.action")}</Th>
                </tr>
              </thead>
              <tbody>
                {suggestions.map((s) => {
                  const isActing = acting[s.id] ?? false;
                  return (
                    <tr key={s.id}>
                      <Td className="whitespace-nowrap font-mono text-xs">{s.agentId}</Td>
                      <Td className="max-w-[420px]">
                        <span className="block whitespace-pre-wrap text-fg-2">{s.suggestion}</span>
                        {s.sourcePatterns && (
                          <span className="mt-1 block text-[11px] text-faint" title={s.sourcePatterns}>
                            {t("sourcePatterns", { patterns: s.sourcePatterns })}
                          </span>
                        )}
                      </Td>
                      <Td className="text-right font-mono">
                        {s.qualityScore != null ? s.qualityScore.toFixed(2) : "-"}
                      </Td>
                      <Td>
                        <Badge tone={STATUS_TONE[s.status]}>{t(`filter.${s.status}`)}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">{fmtDateTime(s.createdAt)}</Td>
                      <Td>
                        {s.status === "pending" ? (
                          <div className="flex items-center gap-1">
                            <Button size="sm" disabled={isActing} onClick={() => void decide(s.id, "approve")}>
                              {isActing
                                ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                                : <Check className="h-3 w-3" aria-hidden />}
                              {t("approve")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isActing}
                              onClick={() => void decide(s.id, "reject")}
                            >
                              <X className="h-3 w-3" aria-hidden />
                              {t("reject")}
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-faint">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
