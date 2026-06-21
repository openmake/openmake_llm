"use client";

import { useEffect, useState } from "react";
import { Bell, Plus, AlertTriangle, AlertCircle, Info, Check } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ApiClient } from "@/lib/api-client";

type Severity = "critical" | "warning" | "info";

interface AlertRule {
  id: string;
  name: string;
  condition: string;
  channel: string[];
  enabled: boolean;
}

interface AlertEvent {
  id: string;
  severity: Severity;
  message: string;
  timestamp: string;
}

const SEV_TONE: Record<Severity, "danger" | "warn" | "accent"> = {
  critical: "danger",
  warning: "warn",
  info: "accent",
};
const SEV_LABEL: Record<Severity, string> = {
  critical: "심각",
  warning: "경고",
  info: "정보",
};
const SEV_ICON: Record<Severity, typeof Info> = {
  critical: AlertTriangle,
  warning: AlertCircle,
  info: Info,
};
const SEV_ICON_CLR: Record<Severity, string> = {
  critical: "text-danger",
  warning: "text-warn",
  info: "text-accent",
};

// 알림 규칙(rule) CRUD 백엔드 엔드포인트 없음 — AlertSystem 은 코드 내 config 로 규칙을
// 관리하고 발생 이력만 alert_history 에 영속화. 따라서 규칙 목록은 목업 유지(토글도 로컬 전용).
const RULES: AlertRule[] = [
  { id: "r1", name: "CPU 사용률 임계", condition: "CPU > 85% · 5분 지속", channel: ["webhook", "email"], enabled: true },
  { id: "r2", name: "LLM 컨텍스트 오버플로", condition: "ContextOverflowError 발생", channel: ["webhook"], enabled: true },
  { id: "r3", name: "에러율 급증", condition: "5xx 비율 > 2%", channel: ["webhook", "slack"], enabled: true },
  { id: "r4", name: "토큰 쿼터 소진", condition: "주간 쿼터 90% 초과", channel: ["email"], enabled: false },
  { id: "r5", name: "관리자 권한 변경", condition: "user.role_change → admin", channel: ["webhook", "email"], enabled: true },
];

const MOCK_EVENTS: AlertEvent[] = [
  { id: "e1", severity: "critical", message: "관리자 권한 부여 감지 — u_1040 (devops@partner.co.kr 수행)", timestamp: "2026-06-21T03:40:22Z" },
  { id: "e2", severity: "warning", message: "redis-kv 노드 부하 78% — rate-limit 정합 영향 가능", timestamp: "2026-06-21T03:12:00Z" },
  { id: "e3", severity: "warning", message: "LLM 컨텍스트 오버플로 1건 — conv_88412 truncate 적용", timestamp: "2026-06-21T03:31:05Z" },
  { id: "e4", severity: "info", message: "일일 백업 완료 — postgres-primary (2.1GB)", timestamp: "2026-06-21T02:00:00Z" },
  { id: "e5", severity: "critical", message: "비정상 로그인 시도 12회 — 45.33.21.7 차단됨", timestamp: "2026-06-20T22:31:00Z" },
];

function fmt(s: string) {
  return new Date(s).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// GET /api/admin/alerts/history (admin) → { data: { history: [...], total } }
// alert_history 스키마: id/type/severity/title/message/data/created_at/acknowledged...
interface ApiAlert {
  id?: string | number;
  severity?: string;
  title?: string;
  message?: string;
  created_at?: string;
}

export default function AdminAlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>(RULES);
  const [events, setEvents] = useState<AlertEvent[]>(MOCK_EVENTS);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set());
  const [ackLoading, setAckLoading] = useState<Set<string>>(new Set());

  async function handleAcknowledge(id: string) {
    setAckLoading((prev) => new Set(prev).add(id));
    try {
      await ApiClient.post(`/api/admin/alerts/${id}/acknowledge`, {});
      setAcknowledged((prev) => new Set(prev).add(id));
    } catch {
      /* 실패 시 현상 유지 */
    } finally {
      setAckLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<{ data?: { history?: ApiAlert[] }; history?: ApiAlert[] }>("/api/admin/alerts/history?limit=50");
        const payload = res.data ?? res;
        const raw = (payload.history as ApiAlert[]) ?? [];
        if (!alive || !raw.length) return;
        setEvents(
          raw.map((a, i) => ({
            id: String(a.id ?? i),
            severity: (["critical", "warning", "info"].includes(String(a.severity)) ? a.severity : "info") as Severity,
            message: [a.title, a.message].filter(Boolean).join(" — ") || "-",
            timestamp: a.created_at ?? "",
          })),
        );
      } catch {
        /* 401/실패 시 목업 유지 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (id: string) =>
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));

  return (
    <>
      <PageHeader
        title="알림"
        description="알림 규칙을 관리하고 최근 발생 이벤트를 확인합니다."
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> 규칙 추가
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-accent" />
              <CardTitle>알림 규칙</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{r.name}</p>
                    <p className="mt-0.5 text-xs text-muted">{r.condition}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.channel.map((c) => (
                        <span
                          key={c}
                          className="rounded-pill bg-surface-3 px-2 py-0.5 font-mono text-[10px] text-muted"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => toggle(r.id)} aria-label="규칙 활성 토글">
                    <Badge tone={r.enabled ? "success" : "neutral"}>
                      {r.enabled ? "활성" : "비활성"}
                    </Badge>
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>최근 발생 알림</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l border-border pl-5">
                {events.map((e) => {
                  const Icon = SEV_ICON[e.severity];
                  const isAcked = acknowledged.has(e.id);
                  const isAcking = ackLoading.has(e.id);
                  return (
                    <li key={e.id} className={cn("relative", isAcked && "opacity-50")}>
                      <span
                        className={cn(
                          "absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-surface",
                          SEV_ICON_CLR[e.severity],
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={SEV_TONE[e.severity]}>{SEV_LABEL[e.severity]}</Badge>
                          <span className="font-mono text-[11px] text-faint">{fmt(e.timestamp)}</span>
                          {isAcked && (
                            <Badge tone="success">
                              <Check className="h-3 w-3" />
                              확인됨
                            </Badge>
                          )}
                        </div>
                        {!isAcked && (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isAcking}
                            onClick={() => handleAcknowledge(e.id)}
                          >
                            확인
                          </Button>
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-fg-2">{e.message}</p>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
