"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
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
  nameKey: string;
  conditionKey: string;
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
const SEV_LABEL_KEY: Record<Severity, string> = {
  critical: "status.critical",
  warning: "status.warning",
  info: "status.info",
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
  { id: "r1", nameKey: "rules.cpu.name", conditionKey: "rules.cpu.condition", channel: ["webhook", "email"], enabled: true },
  { id: "r2", nameKey: "rules.contextOverflow.name", conditionKey: "rules.contextOverflow.condition", channel: ["webhook"], enabled: true },
  { id: "r3", nameKey: "rules.errorRate.name", conditionKey: "rules.errorRate.condition", channel: ["webhook", "slack"], enabled: true },
  { id: "r4", nameKey: "rules.tokenQuota.name", conditionKey: "rules.tokenQuota.condition", channel: ["email"], enabled: false },
  { id: "r5", nameKey: "rules.roleChange.name", conditionKey: "rules.roleChange.condition", channel: ["webhook", "email"], enabled: true },
];

const MOCK_EVENTS: { id: string; severity: Severity; messageKey: string; timestamp: string }[] = [
  { id: "e1", severity: "critical", messageKey: "events.e1", timestamp: "2026-06-21T03:40:22Z" },
  { id: "e2", severity: "warning", messageKey: "events.e2", timestamp: "2026-06-21T03:12:00Z" },
  { id: "e3", severity: "warning", messageKey: "events.e3", timestamp: "2026-06-21T03:31:05Z" },
  { id: "e4", severity: "info", messageKey: "events.e4", timestamp: "2026-06-21T02:00:00Z" },
  { id: "e5", severity: "critical", messageKey: "events.e5", timestamp: "2026-06-20T22:31:00Z" },
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
  const t = useTranslations("adminAlerts");
  const [rules, setRules] = useState<AlertRule[]>(RULES);
  const [events, setEvents] = useState<AlertEvent[]>(() =>
    MOCK_EVENTS.map((e) => ({
      id: e.id,
      severity: e.severity,
      message: t(e.messageKey),
      timestamp: e.timestamp,
    })),
  );
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
        title={t("title")}
        description={t("description")}
        actions={
          <Button size="sm">
            <Plus className="h-3.5 w-3.5" /> {t("addRule")}
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-accent" />
              <CardTitle>{t("rulesTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-fg">{t(r.nameKey)}</p>
                    <p className="mt-0.5 text-xs text-muted">{t(r.conditionKey)}</p>
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
                  <button onClick={() => toggle(r.id)} aria-label={t("toggleAria")}>
                    <Badge tone={r.enabled ? "success" : "neutral"}>
                      {r.enabled ? t("enabled") : t("disabled")}
                    </Badge>
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("recentTitle")}</CardTitle>
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
                          <Badge tone={SEV_TONE[e.severity]}>{t(SEV_LABEL_KEY[e.severity])}</Badge>
                          <span className="font-mono text-[11px] text-faint">{fmt(e.timestamp)}</span>
                          {isAcked && (
                            <Badge tone="success">
                              <Check className="h-3 w-3" />
                              {t("acknowledged")}
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
                            {t("acknowledge")}
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
