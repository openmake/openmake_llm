"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { Bell, AlertTriangle, AlertCircle, Info, Check, ExternalLink } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
} from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import { cn } from "@/lib/utils";
import { toBcp47 } from "@/i18n/config";
import { ApiClient } from "@/lib/api-client";

type Severity = "critical" | "warning" | "info";


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

function fmt(s: string, locale: string) {
  return new Date(s).toLocaleString(locale, {
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
  const locale = toBcp47(useLocale());
  // 실데이터만 표시 — alert_history 응답이 비면 빈 상태(t("empty"))로 둔다.
  const [events, setEvents] = useState<AlertEvent[]>([]);
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

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      <AdminTabs />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-accent" />
              <CardTitle>{t("rulesTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              {/* 규칙 CRUD 백엔드가 없다 — 그전엔 하드코딩 규칙 5개와 동작 없는 [규칙 추가]·로컬
                  전용 토글이 실제 설정처럼 보였다. 임계값·채널은 시스템 설정(alerts 그룹)이 SoT. */}
              <p className="text-sm text-muted">{t("rulesMovedHint")}</p>
              <Link
                href="/admin/system-settings"
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                {t("rulesMovedLink")}
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("recentTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l border-border pl-5">
                {events.length === 0 && <li className="py-4 text-sm text-muted">{t("empty")}</li>}
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
                          <span className="font-mono text-[11px] text-faint">{fmt(e.timestamp, locale)}</span>
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
