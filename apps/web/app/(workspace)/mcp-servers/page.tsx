"use client";

import { useEffect, useState } from "react";
import { Server, Boxes, Plus } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 ────────────────────────────────────────────────── */
type Transport = "stdio" | "SSE" | "HTTP";
type ConnStatus = "connected" | "degraded" | "disconnected";

interface McpServer {
  id: string;
  name: string;
  transport: Transport;
  toolCount: number;
  status: ConnStatus;
  latencyMs: number | null;
  lastChecked: string;
}

/* ── 백엔드 응답 타입 (GET /api/mcp/servers) ──────────────── */
interface ApiMcpServer {
  id: string;
  name: string;
  transport_type: "stdio" | "sse" | "streamable-http";
  connectionStatus?: string;
  toolCount?: number;
  lastPing?: string | null;
}

const TRANSPORT_MAP: Record<ApiMcpServer["transport_type"], Transport> = {
  stdio: "stdio",
  sse: "SSE",
  "streamable-http": "HTTP",
};

function mapStatus(s?: string): ConnStatus {
  if (s === "connected") return "connected";
  if (s === "degraded") return "degraded";
  return "disconnected";
}

function relativeTime(iso?: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diffSec = Math.round((Date.now() - t) / 1000);
  if (diffSec < 60) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  return `${Math.floor(diffSec / 86400)}일 전`;
}

function mapServer(s: ApiMcpServer): McpServer {
  return {
    id: s.id,
    name: s.name,
    transport: TRANSPORT_MAP[s.transport_type] ?? "stdio",
    toolCount: s.toolCount ?? 0,
    status: mapStatus(s.connectionStatus),
    // 백엔드는 지연(latency) 수치를 제공하지 않음 — 표시 생략
    latencyMs: null,
    lastChecked: relativeTime(s.lastPing),
  };
}

/* ── 목업 데이터 — TODO: API 연동 (GET /api/mcp/servers) ──── */
const MOCK_SERVERS: McpServer[] = [
  {
    id: "filesystem",
    name: "filesystem",
    transport: "stdio",
    toolCount: 8,
    status: "connected",
    latencyMs: 12,
    lastChecked: "방금 전",
  },
  {
    id: "github",
    name: "github",
    transport: "HTTP",
    toolCount: 21,
    status: "connected",
    latencyMs: 184,
    lastChecked: "1분 전",
  },
  {
    id: "postgres-prod",
    name: "postgres-prod",
    transport: "stdio",
    toolCount: 5,
    status: "degraded",
    latencyMs: 842,
    lastChecked: "2분 전",
  },
  {
    id: "slack-events",
    name: "slack-events",
    transport: "SSE",
    toolCount: 11,
    status: "connected",
    latencyMs: 76,
    lastChecked: "3분 전",
  },
  {
    id: "weather-api",
    name: "weather-api",
    transport: "HTTP",
    toolCount: 3,
    status: "disconnected",
    latencyMs: null,
    lastChecked: "12분 전",
  },
];

const STATUS_META: Record<
  ConnStatus,
  { label: string; tone: "success" | "warn" | "danger" }
> = {
  connected: { label: "연결됨", tone: "success" },
  degraded: { label: "지연", tone: "warn" },
  disconnected: { label: "연결 끊김", tone: "danger" },
};

const TRANSPORT_TONE: Record<Transport, "accent" | "neutral"> = {
  stdio: "neutral",
  SSE: "accent",
  HTTP: "accent",
};

export default function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>(MOCK_SERVERS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<ApiEnvelope<{ servers: ApiMcpServer[] }>>(
          "/api/mcp/servers",
        );
        if (cancelled) return;
        const list = res?.data?.servers ?? [];
        setServers(list.map(mapServer));
      } catch {
        // 401·네트워크 실패 등 → 목업 유지 (데모)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title="MCP 서버"
        description="로컬 도구를 LLM 이 사용할 수 있도록 연결합니다."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Boxes className="h-4 w-4" />
              카탈로그
            </Button>
            <Button size="sm">
              <Plus className="h-4 w-4" />
              서버 추가
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <Card className="overflow-hidden">
          <Table>
            <thead>
              <tr>
                <Th>이름</Th>
                <Th>유형</Th>
                <Th className="text-right">도구 수</Th>
                <Th>상태</Th>
                <Th className="text-right">지연</Th>
                <Th>마지막 확인</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <Td colSpan={6}>
                    <div className="py-12 text-center text-muted">로딩 중…</div>
                  </Td>
                </tr>
              ) : servers.length === 0 ? (
                <tr>
                  <Td colSpan={6}>
                    <div className="py-12 text-center text-muted">
                      연결된 MCP 서버가 없습니다. 카탈로그에서 추가하세요.
                    </div>
                  </Td>
                </tr>
              ) : (
                servers.map((s) => {
                  const meta = STATUS_META[s.status];
                  return (
                    <tr key={s.id} className="transition hover:bg-surface-2">
                      <Td>
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-faint" />
                          <span className="font-medium text-fg">{s.name}</span>
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={TRANSPORT_TONE[s.transport]}>
                          <span className="font-mono">{s.transport}</span>
                        </Badge>
                      </Td>
                      <Td className="text-right font-mono text-fg">
                        {s.toolCount}
                      </Td>
                      <Td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </Td>
                      <Td className="text-right font-mono">
                        {s.latencyMs == null ? (
                          <span className="text-faint">—</span>
                        ) : (
                          <span
                            className={
                              s.latencyMs > 500 ? "text-warn" : "text-fg-2"
                            }
                          >
                            {s.latencyMs}ms
                          </span>
                        )}
                      </Td>
                      <Td className="text-faint">{s.lastChecked}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
