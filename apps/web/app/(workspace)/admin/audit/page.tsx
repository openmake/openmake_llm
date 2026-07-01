"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ScrollText, Download } from "lucide-react";
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ApiClient } from "@/lib/api-client";

type Severity = "critical" | "warn" | "info";

interface AuditLog {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  severity: Severity;
  ip: string;
}

const SEV_TONE: Record<Severity, "danger" | "warn" | "neutral"> = {
  critical: "danger",
  warn: "warn",
  info: "neutral",
};
const SEV_LABEL_KEY: Record<Severity, string> = {
  critical: "status.critical",
  warn: "status.warn",
  info: "status.info",
};

// TODO: API 연동 (/api/audit) — 응답 실패 시 폴백 목업
const MOCK_LOGS: AuditLog[] = [
  { id: "a1", timestamp: "2026-06-21T03:42:11Z", actor: "devops@partner.co.kr", action: "user.delete", target: "u_1031", severity: "critical", ip: "203.0.113.41" },
  { id: "a2", timestamp: "2026-06-21T03:31:05Z", actor: "system", action: "llm.context_overflow", target: "conv_88412", severity: "warn", ip: "127.0.0.1" },
  { id: "a3", timestamp: "2026-06-21T02:58:47Z", actor: "minji.kim@openmake.io", action: "apikey.create", target: "key_7f3a", severity: "info", ip: "211.45.12.9" },
  { id: "a4", timestamp: "2026-06-21T02:40:22Z", actor: "devops@partner.co.kr", action: "user.role_change", target: "u_1040 → admin", severity: "critical", ip: "203.0.113.41" },
  { id: "a5", timestamp: "2026-06-21T01:55:10Z", actor: "system", action: "alert.dispatched", target: "rule_cpu_high", severity: "warn", ip: "127.0.0.1" },
  { id: "a6", timestamp: "2026-06-21T01:12:33Z", actor: "sangho.park@openmake.io", action: "auth.login", target: "session_a91", severity: "info", ip: "118.32.74.201" },
  { id: "a7", timestamp: "2026-06-20T23:48:01Z", actor: "research.lab@yonsei.ac.kr", action: "mcp.server_register", target: "srv_filesystem", severity: "info", ip: "166.104.5.18" },
  { id: "a8", timestamp: "2026-06-20T22:30:55Z", actor: "system", action: "auth.failed_attempt", target: "unknown@spam.io", severity: "warn", ip: "45.33.21.7" },
];

const ALL_ACTIONS = "__all__";
const ACTIONS = [ALL_ACTIONS, "user.delete", "user.role_change", "apikey.create", "auth.login", "auth.failed_attempt", "mcp.server_register", "llm.context_overflow", "alert.dispatched"];
const SEVERITIES: { key: "all" | Severity; labelKey: string }[] = [
  { key: "all", labelKey: "severity.all" },
  { key: "critical", labelKey: "status.critical" },
  { key: "warn", labelKey: "status.warn" },
  { key: "info", labelKey: "status.info" },
];
const PERIODS: { key: string; labelKey: string }[] = [
  { key: "today", labelKey: "period.today" },
  { key: "days7", labelKey: "period.days7" },
  { key: "days30", labelKey: "period.days30" },
  { key: "all", labelKey: "period.all" },
];

function fmt(s: string) {
  return new Date(s).toLocaleString("ko-KR", {
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
  const [logs, setLogs] = useState<AuditLog[]>(MOCK_LOGS);
  const [action, setAction] = useState(ALL_ACTIONS);
  const [severity, setSeverity] = useState<"all" | Severity>("all");
  const [period, setPeriod] = useState("days7");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // GET /api/audit (admin 전용) → { success, data: { logs, total } }
        const res = await ApiClient.get<{ data?: { logs?: ApiAuditLog[] }; logs?: ApiAuditLog[] }>("/api/audit?limit=50");
        const payload = res.data ?? res;
        const raw = (payload.logs as ApiAuditLog[]) ?? [];
        if (!alive || !raw.length) return;
        setLogs(
          raw.map((l, i) => ({
            id: String(l.id ?? i),
            timestamp: l.timestamp ?? "",
            actor: l.user_id ?? "-",
            action: l.action ?? "-",
            target: [l.resource_type, l.resource_id].filter(Boolean).join(":") || "-",
            // severity: audit_logs 미보유 컬럼 → 'info' 고정 (필터는 클라이언트 전용 best-effort)
            severity: "info" as Severity,
            ip: l.ip_address ?? "-",
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

  const filtered = useMemo(
    () =>
      logs.filter(
        (l) =>
          (action === ALL_ACTIONS || l.action === action) &&
          (severity === "all" || l.severity === severity),
      ),
    [logs, action, severity],
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
              onClick={() => { window.location.href = "/api/audit/export"; }}
            >
              <Download className="h-4 w-4" />
              {t("exportCsv")}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select className={selectCls} value={action} onChange={(e) => setAction(e.target.value)}>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a === ALL_ACTIONS ? t("filter.allActions") : a}
              </option>
            ))}
          </select>
          <select
            className={selectCls}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as "all" | Severity)}
          >
            {SEVERITIES.map((s) => (
              <option key={s.key} value={s.key}>
                {t(s.labelKey)}
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
                  <Th>{t("th.severity")}</Th>
                  <Th>IP</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <Td className="py-8 text-center text-muted" colSpan={6}>
                      {t("empty")}
                    </Td>
                  </tr>
                ) : (
                  filtered.map((l) => (
                    <tr key={l.id}>
                      <Td className="whitespace-nowrap font-mono text-xs text-muted">{fmt(l.timestamp)}</Td>
                      <Td className="text-fg">{l.actor}</Td>
                      <Td className="font-mono text-xs text-fg-2">{l.action}</Td>
                      <Td className="font-mono text-xs text-muted">{l.target}</Td>
                      <Td>
                        <Badge tone={SEV_TONE[l.severity]}>{t(SEV_LABEL_KEY[l.severity])}</Badge>
                      </Td>
                      <Td className="font-mono text-xs text-muted">{l.ip}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
