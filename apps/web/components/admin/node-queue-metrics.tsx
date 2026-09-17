"use client";

/**
 * 관리자 지표 — vLLM 노드(KV 캐시·대기/실행 요청·TTFT)와 큐 깊이 카드 (F24.4, 143).
 * 백엔드 `/api/metrics/gpu`·`/api/metrics/queues`. 스크레이프가 끊긴 노드는 stale 배지로 표시한다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Badge, Card, CardContent, CardHeader, CardTitle, StatCard, Table, Td, Th } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";

interface NodeSnapshot {
  kvCacheUsagePct?: number;
  requestsRunning?: number;
  requestsWaiting?: number;
  preemptionsTotal?: number;
  ttftAvgSeconds?: number;
  models?: string[];
  gpuUtilPct?: number;
  gpuTempC?: number;
}
interface NodeState { nodeId: string; snapshot: NodeSnapshot | null; lastOkAt: string | null; lastError: string | null; stale: boolean }
interface SeriesPoint { bucket: string; metric: string; node_id: string; labels: Record<string, string> | null; avg: number; max: number }
interface GpuData { enabled: boolean; targets: number; nodes: NodeState[]; hours: number; series: SeriesPoint[] }
interface QueueData {
  enabled: boolean;
  hours: number;
  current: Record<string, number | null | string> | null;
  series: SeriesPoint[];
}

const QUEUE_KEYS = ["agent_task_pending", "agent_task_running", "agent_task_queued_db", "orchestrator_jobs_pending", "vllm_waiting"] as const;

function fmt(v: number | undefined | null, suffix = ""): string {
  return v === undefined || v === null ? "—" : `${Math.round(v * 10) / 10}${suffix}`;
}

function peak(series: SeriesPoint[], match: (p: SeriesPoint) => boolean): number | undefined {
  const xs = series.filter(match).map((p) => p.max);
  return xs.length ? Math.max(...xs) : undefined;
}

export function NodeQueueMetrics({ refreshKey }: { refreshKey?: string }) {
  const t = useTranslations("adminMetrics.nodeMetrics");
  const [gpu, setGpu] = useState<GpuData | null>(null);
  const [queues, setQueues] = useState<QueueData | null>(null);

  const load = useCallback(async () => {
    const [g, q] = await Promise.all([
      ApiClient.get<{ data: GpuData }>("/api/metrics/gpu").catch(() => null),
      ApiClient.get<{ data: QueueData }>("/api/metrics/queues").catch(() => null),
    ]);
    setGpu(g?.data ?? null);
    setQueues(q?.data ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (!gpu && !queues) return null;
  if (gpu && !gpu.enabled) {
    return (
      <Card className="mt-6">
        <CardHeader><CardTitle>{t("gpuTitle")}</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted">{t("disabled")}</CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mt-6">
        <CardHeader><CardTitle>{t("gpuTitle")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>{t("th.node")}</Th>
                  <Th>{t("th.state")}</Th>
                  <Th className="text-right">{t("th.kv")}</Th>
                  <Th className="text-right">{t("th.kvPeak", { hours: gpu?.hours ?? 0 })}</Th>
                  <Th className="text-right">{t("th.running")}</Th>
                  <Th className="text-right">{t("th.waiting")}</Th>
                  <Th className="text-right">{t("th.ttft")}</Th>
                  <Th className="text-right">{t("th.gpuUtil")}</Th>
                </tr>
              </thead>
              <tbody>
                {(gpu?.nodes.length ?? 0) === 0 && (
                  <tr><Td className="py-6 text-center text-muted" colSpan={8}>{gpu?.targets ? t("waitingFirstScrape") : t("noTargets")}</Td></tr>
                )}
                {gpu?.nodes.map((n) => (
                  <tr key={n.nodeId}>
                    <Td className="font-mono text-xs text-fg">
                      {n.nodeId}
                      {n.snapshot?.models?.length ? <span className="ml-2 text-muted">{n.snapshot.models.join(", ")}</span> : null}
                    </Td>
                    <Td>
                      {n.stale
                        ? <Badge tone="warn" title={n.lastError ?? undefined}>{t("stale")}</Badge>
                        : <Badge tone="success">{t("fresh")}</Badge>}
                    </Td>
                    <Td className="text-right font-mono text-xs">{fmt(n.snapshot?.kvCacheUsagePct, "%")}</Td>
                    <Td className="text-right font-mono text-xs">{fmt(peak(gpu.series, (p) => p.metric === "vllm_kv_cache_pct" && p.node_id === n.nodeId), "%")}</Td>
                    <Td className="text-right font-mono text-xs">{fmt(n.snapshot?.requestsRunning)}</Td>
                    <Td className="text-right font-mono text-xs">{fmt(n.snapshot?.requestsWaiting)}</Td>
                    <Td className="text-right font-mono text-xs">{fmt(n.snapshot?.ttftAvgSeconds, "s")}</Td>
                    <Td className="text-right font-mono text-xs">{fmt(n.snapshot?.gpuUtilPct, "%")}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {queues?.enabled && (
        <Card className="mt-6">
          <CardHeader><CardTitle>{t("queueTitle")}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {QUEUE_KEYS.map((k) => {
                const cur = queues.current?.[k];
                const pk = peak(queues.series, (p) => p.labels?.queue === k);
                return (
                  <StatCard
                    key={k}
                    label={t(`queue.${k}`)}
                    value={typeof cur === "number" ? String(cur) : "—"}
                    delta={t("peak", { hours: queues.hours, value: fmt(pk) })}
                  />
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
