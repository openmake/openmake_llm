"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge, RefreshCw } from "lucide-react";
import {
  PageHeader,
  StatCard,
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
import { ApiClient } from "@/lib/api-client";

type NodeStatus = "online" | "degraded" | "offline";

interface NodeRow {
  name: string;
  role: string;
  status: NodeStatus;
  latency: string;
  load: string;
}

const STATUS_TONE: Record<NodeStatus, "success" | "warn" | "danger"> = {
  online: "success",
  degraded: "warn",
  offline: "danger",
};
const STATUS_LABEL: Record<NodeStatus, string> = {
  online: "정상",
  degraded: "저하",
  offline: "중단",
};

// 클러스터 노드/CPU/메모리는 /api/metrics·/api/metrics/metrics 실데이터로 오버레이.
// 요청률 24h 시계열·요청률/에러율 StatCard 는 백엔드 시계열 미제공(usage-tracker stub)이라 목업 유지.
const NODES: NodeRow[] = [
  { name: "vllm-qwen-262k", role: "LLM · 262K", status: "online", latency: "0.82s", load: "61%" },
  { name: "vllm-bge-m3", role: "Embedding", status: "online", latency: "0.04s", load: "23%" },
  { name: "litellm-proxy", role: "Proxy :13401", status: "online", latency: "0.01s", load: "12%" },
  { name: "postgres-primary", role: "Database", status: "online", latency: "0.6ms", load: "34%" },
  { name: "redis-kv", role: "KV / Rate-limit", status: "degraded", latency: "1.2ms", load: "78%" },
  { name: "api-server-2", role: "API (PM2)", status: "online", latency: "12ms", load: "44%" },
];

// 24시간 요청률 시계열 (req/min)
const TIMESERIES = Array.from({ length: 24 }, (_, h) => ({
  hour: h,
  value: 120 + Math.round(Math.abs(Math.sin((h - 4) / 3) * 480) + (h >= 9 && h <= 18 ? 220 : 0)),
}));

type Cat = { id?: string; name?: string; status?: string; latency?: number | string };

const STATUS_MAP: Record<string, NodeStatus> = {
  online: "online",
  offline: "offline",
  busy: "degraded",
  unknown: "degraded",
};

export default function AdminMetricsPage() {
  const [updated, setUpdated] = useState<string>("");
  const [nodes, setNodes] = useState<NodeRow[]>(NODES);
  const [cpu, setCpu] = useState<string | null>(null);
  const [mem, setMem] = useState<{ value: string; delta: string } | null>(null);
  const maxV = Math.max(...TIMESERIES.map((t) => t.value));

  const load = useCallback(async () => {
    try {
      const [m, detail] = await Promise.allSettled([
        // GET /api/metrics → { data: { cluster: { nodes: [...] } } }
        ApiClient.get<{ data?: { cluster?: { nodes?: Cat[] } } }>("/api/metrics"),
        // GET /api/metrics/metrics → { data: { system: { cpu, memory } } }
        ApiClient.get<{
          data?: {
            system?: {
              cpu?: { cores?: number; loadAvg?: number[] };
              memory?: { used?: number; total?: number; percentage?: number };
            };
          };
        }>("/api/metrics/metrics"),
      ]);

      if (m.status === "fulfilled") {
        const list = m.value.data?.cluster?.nodes ?? [];
        if (list.length) {
          setNodes(
            list.map((n) => ({
              name: n.name ?? n.id ?? "node",
              role: "LLM 노드",
              status: STATUS_MAP[String(n.status)] ?? "degraded",
              latency:
                typeof n.latency === "number" ? `${n.latency}ms` : (n.latency ?? "-"),
              load: "-", // 백엔드 미제공
            })),
          );
        }
      }

      if (detail.status === "fulfilled" && detail.value.data?.system) {
        const sys = detail.value.data.system;
        const cores = sys.cpu?.cores ?? 0;
        const load1 = sys.cpu?.loadAvg?.[0];
        if (load1 != null && cores > 0) {
          setCpu(`${Math.min(100, Math.round((load1 / cores) * 100))}%`);
        }
        if (sys.memory?.used != null && sys.memory?.total != null) {
          setMem({
            value: `${(sys.memory.used / 1024).toFixed(1)} GB`,
            delta: `총 ${(sys.memory.total / 1024).toFixed(1)} GB 중`,
          });
        }
      }
    } catch {
      /* 401/실패 시 목업 유지 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setUpdated(new Date().toLocaleTimeString("ko-KR"));
    void load();
  };

  return (
    <>
      <PageHeader
        title="시스템 메트릭"
        description={updated ? `마지막 갱신 ${updated}` : "시스템 상태 및 리소스 실시간 모니터링"}
        actions={
          <Button variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="CPU 사용률" value={cpu ?? "47%"} delta="load avg / cores" deltaTone="success" />
          <StatCard label="메모리" value={mem?.value ?? "6.2 GB"} delta={mem?.delta ?? "총 16 GB 중"} />
          <StatCard label="요청률" value="612/min" delta="+8.4%" />
          <StatCard label="에러율" value="0.21%" delta="+0.04%" deltaTone="danger" />
        </div>

        <Card className="mt-6">
          <CardHeader className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-accent" />
            <CardTitle>요청률 (최근 24시간 · req/min)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-end gap-1">
              {TIMESERIES.map((t) => (
                <div
                  key={t.hour}
                  className="group flex h-full flex-1 flex-col items-center justify-end gap-1"
                  title={`${String(t.hour).padStart(2, "0")}시: ${t.value}/min`}
                >
                  <div
                    className="w-full rounded-t bg-accent/70 transition group-hover:bg-accent"
                    style={{ height: `${Math.max(4, (t.value / maxV) * 100)}%` }}
                  />
                  {t.hour % 3 === 0 && (
                    <span className="text-[9px] text-faint">{String(t.hour).padStart(2, "0")}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>노드 · 서비스 상태</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>노드</Th>
                  <Th>역할</Th>
                  <Th>상태</Th>
                  <Th>지연</Th>
                  <Th>부하</Th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.name}>
                    <Td className="font-mono text-xs text-fg">{n.name}</Td>
                    <Td className="text-muted">{n.role}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[n.status]}>{STATUS_LABEL[n.status]}</Badge>
                    </Td>
                    <Td className="font-mono text-xs text-fg-2">{n.latency}</Td>
                    <Td className="font-mono text-xs text-fg-2">{n.load}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
