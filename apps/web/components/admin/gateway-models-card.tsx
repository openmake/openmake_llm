"use client";

/**
 * 게이트웨이 모델 상태 (UX·게이트웨이 PR-14) — LiteLLM `/model/info` 라우트와 로컬 카탈로그 가용성, 기본 모델.
 * 백엔드 `/api/admin/gateway/models`. 게이트웨이 조회 실패는 200 `{ok:false, reason}` 로 와서 사유를 그대로 보인다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Network, RefreshCw } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";

interface GatewayModelRow {
  name: string;
  upstream: string | null;
  mode: string | null;
  local: boolean;
  available: boolean | null;
  unavailableReason: string | null;
  isDefault: boolean;
}
interface GatewayModelsPayload {
  ok: boolean;
  reason?: string;
  defaultModel: string;
  models: GatewayModelRow[];
}

export function GatewayModelsCard() {
  const t = useTranslations("adminGatewayModels");
  const [payload, setPayload] = useState<GatewayModelsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<GatewayModelsPayload>>("/api/admin/gateway/models");
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

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Network className="h-4 w-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading} aria-label={t("refresh")}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">{t("description")}</p>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        {payload && !payload.ok && (
          <p className="rounded bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {t("unreachable", { reason: payload.reason ?? "" })}
          </p>
        )}
        {payload?.ok && (
          payload.models.length === 0 ? (
            <p className="text-sm text-muted">{t("empty")}</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("col.name")}</Th>
                  <Th>{t("col.upstream")}</Th>
                  <Th>{t("col.mode")}</Th>
                  <Th>{t("col.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {payload.models.map((m) => (
                  <tr key={m.name}>
                    <Td className="font-mono text-xs">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {m.name}
                        {m.isDefault && <Badge tone="accent">{t("default")}</Badge>}
                      </span>
                    </Td>
                    <Td className="font-mono text-xs text-muted">{m.upstream ?? "—"}</Td>
                    <Td className="text-xs">{m.mode ?? "—"}</Td>
                    <Td>
                      {!m.local ? (
                        <Badge tone="neutral">{t("status.external")}</Badge>
                      ) : m.available === null ? (
                        <Badge tone="neutral">{t("status.uncataloged")}</Badge>
                      ) : m.available ? (
                        <Badge tone="success">{t("status.available")}</Badge>
                      ) : (
                        <Badge tone="danger" title={m.unavailableReason ?? undefined}>{t("status.unavailable")}</Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        )}
        {payload && <p className="text-xs text-muted">{t("defaultNote", { model: payload.defaultModel })}</p>}
      </CardContent>
    </Card>
  );
}
