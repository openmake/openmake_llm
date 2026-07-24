"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, RefreshCw, Loader2 } from "lucide-react";
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

/* ── 타입 (백엔드 /api/admin/agent-task-schedules) ── */
interface AdminSchedule {
  id: string;
  user_id?: string;
  owner_email: string | null;
  goal: string;
  cron?: string | null;
  interval_seconds?: number | null;
  enabled: boolean;
  next_run_at: string;
  last_run_at?: string | null;
  last_task_status: string | null;
  last_task_error: string | null;
  consecutive_failures: number;
  created_at: string;
}
interface SchedulesPayload {
  schedules: AdminSchedule[];
  total: number;
}

const TASK_STATUS_TONE: Record<string, "success" | "danger" | "warn" | "neutral"> = {
  completed: "success",
  failed: "danger",
  running: "warn",
  paused: "warn",
  queued: "neutral",
};

function fmtDateTime(s?: string | null) {
  if (!s) return "-";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 전체 사용자의 에이전트 작업 스케줄 조회 — admin 전용(읽기). */
export default function AdminSchedulesPage() {
  const t = useTranslations("adminSchedules");
  const [payload, setPayload] = useState<SchedulesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<SchedulesPayload>>("/api/admin/agent-task-schedules");
      setPayload(r?.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const schedules = payload?.schedules ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <AdminTabs />
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4" aria-hidden />
            {t("listTitle", { count: payload?.total ?? 0 })}
          </CardTitle>
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              : <RefreshCw className="h-4 w-4" aria-hidden />}
            {t("refresh")}
          </Button>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 && !loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("cols.owner")}</Th>
                  <Th>{t("cols.goal")}</Th>
                  <Th>{t("cols.trigger")}</Th>
                  <Th>{t("cols.enabled")}</Th>
                  <Th>{t("cols.nextRun")}</Th>
                  <Th>{t("cols.lastRun")}</Th>
                  <Th>{t("cols.lastResult")}</Th>
                  <Th>{t("cols.failures")}</Th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <Td className="whitespace-nowrap">{s.owner_email ?? s.user_id ?? "-"}</Td>
                    <Td className="max-w-[280px]">
                      <span className="block truncate" title={s.goal}>{s.goal}</span>
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-xs">
                      {s.cron ?? (s.interval_seconds != null ? t("intervalSec", { sec: s.interval_seconds }) : "-")}
                    </Td>
                    <Td>
                      <Badge tone={s.enabled ? "success" : "neutral"}>
                        {s.enabled ? t("status.enabled") : t("status.disabled")}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(s.next_run_at)}</Td>
                    <Td className="whitespace-nowrap">{fmtDateTime(s.last_run_at)}</Td>
                    <Td>
                      {s.last_task_status ? (
                        <Badge
                          tone={TASK_STATUS_TONE[s.last_task_status] ?? "neutral"}
                          title={s.last_task_error ?? undefined}
                        >
                          {s.last_task_status}
                        </Badge>
                      ) : "-"}
                    </Td>
                    <Td className="text-center">{s.consecutive_failures}</Td>
                  </tr>
                ))}
              </tbody>
              </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
