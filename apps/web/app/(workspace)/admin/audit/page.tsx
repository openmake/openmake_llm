"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ScrollText, Download } from "lucide-react";
import {
  PageHeader,
  PageBody,
  Card,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import { cn } from "@/lib/utils";
import { toBcp47 } from "@/i18n/config";
import { ApiClient } from "@/lib/api-client";


interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  ip: string;
}

const ALL_ACTIONS = "__all__";
const PERIODS: { key: string; labelKey: string }[] = [
  { key: "today", labelKey: "period.today" },
  { key: "days7", labelKey: "period.days7" },
  { key: "days30", labelKey: "period.days30" },
  { key: "all", labelKey: "period.all" },
];

function fmt(s: string, locale: string) {
  return new Date(s).toLocaleString(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 백엔드 audit_logs 스키마 (legacy-schema.ts): timestamp/action/user_id/
// resource_type/resource_id/details/ip_address/user_agent.
// 주의: audit_logs 에는 severity·actor·target 컬럼이 없음 — UI 의 actor 는 user_id,
// target 은 resource_type+resource_id 로 조립, severity 는 백엔드 미제공이라 'info' 고정.
interface ApiAuditLog {
  id?: string | number;
  timestamp?: string;
  action?: string;
  user_id?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  ip_address?: string | null;
}

export default function AdminAuditPage() {
  const t = useTranslations("adminAudit");
  const locale = toBcp47(useLocale());
  // 실데이터만 표시 — API 응답이 비면 빈 상태(t("empty"))로 둔다.
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState(ALL_ACTIONS);
  const [period, setPeriod] = useState("days7");
  const [actions, setActions] = useState<string[]>([]);
  const [actionsError, setActionsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (action !== ALL_ACTIONS) params.set("action", action);
    if (period !== "all") {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      if (period === "days7") start.setDate(start.getDate() - 6);
      if (period === "days30") start.setDate(start.getDate() - 29);
      params.set("startDate", start.toISOString());
      params.set("endDate", new Date().toISOString());
    }
    return params.toString();
  }, [action, period]);

  useEffect(() => {
    let alive = true;
    ApiClient.get<{ data?: { actions?: string[] }; actions?: string[] }>("/api/audit/actions")
      .then((res) => { if (alive) setActions((res.data ?? res).actions ?? []); })
      .catch(() => { if (alive) setActionsError(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(false);
    (async () => {
      try {
        // GET /api/audit (admin 전용) → { success, data: { logs, total } }
        // 사건을 고르면 서버가 action 으로 거른 최근 50건을 받는다(최근 50건 안에서만 거르던 한계 해소).
        const res = await ApiClient.get<{ data?: { logs?: ApiAuditLog[] }; logs?: ApiAuditLog[] }>(`/api/audit?limit=50&${query}`);
        const payload = res.data ?? res;
        const raw = (payload.logs as ApiAuditLog[]) ?? [];
        if (!alive) return;
        setLogs(
          raw.map((l, i) => ({
            id: String(l.id ?? i),
            timestamp: l.timestamp ?? "",
            actor: l.user_id ?? "-",
            action: l.action ?? "-",
            target: [l.resource_type, l.resource_id].filter(Boolean).join(":") || "-",
            ip: l.ip_address ?? "-",
          })),
        );
      } catch {
        if (!alive) return;
        setLogs([]);
        setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [query]);

  const filtered = useMemo(
    () =>
      // severity 필터·컬럼은 제거 — audit_logs 에 컬럼이 없어 전부 'info' 로 고정돼 있었다(무의미)
      logs.filter((l) => action === ALL_ACTIONS || l.action === action),
    [logs, action],
  );

  const selectCls =
    "h-9 rounded-md border border-border bg-surface px-3 text-sm text-fg-2 outline-none focus:border-border-strong";

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone="neutral">
              <ScrollText className="h-3.5 w-3.5" /> {t("countBadge", { count: filtered.length })}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || error}
              onClick={() => { window.location.href = `/api/audit/export?${query}`; }}
            >
              <Download className="h-4 w-4" />
              {t("exportCsv")}
            </Button>
          </div>
        }
      />
      <AdminTabs />

      <PageBody>
        {actionsError && <p role="alert" className="mb-4 text-sm text-muted">{t("actionsError")}</p>}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select className={selectCls} value={action} onChange={(e) => setAction(e.target.value)}>
            {[ALL_ACTIONS, ...actions].map((a) => (
              <option key={a} value={a}>
                {a === ALL_ACTIONS ? t("filter.allActions") : a}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-pill border border-border bg-surface-2 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={cn(
                  "rounded-pill px-3 py-1 text-xs font-medium transition",
                  period === p.key ? "bg-surface text-fg shadow-1" : "text-muted hover:text-fg",
                )}
              >
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>{t("th.time")}</Th>
                  <Th>{t("th.actor")}</Th>
                  <Th>{t("th.action")}</Th>
                  <Th>{t("th.target")}</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {loading || error || filtered.length === 0 ? (
                  <tr>
                    <Td className="py-8 text-center text-muted" colSpan={5}>
                      {t(loading ? "loading" : error ? "loadError" : "empty")}
                    </Td>
                  </tr>
                ) : (
                  filtered.map((l) => (
                    <tr key={l.id}>
                      <Td className="whitespace-nowrap font-mono text-xs text-muted">{fmt(l.timestamp, locale)}</Td>
                      <Td className="text-fg">{l.actor}</Td>
                      <Td className="font-mono text-xs text-fg-2">{l.action}</Td>
                      <Td className="font-mono text-xs text-muted">{l.target}</Td>
                      <Td className="font-mono text-xs text-muted">{l.ip}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
