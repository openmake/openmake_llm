"use client";

/**
 * 관리자 bridge 허용 옵션(2026-11-08 점검 후속) — 사용자 소유 MCP 서버 목록과 bridge 허용 토글.
 * 네트워크 라벨은 API 의 effective_network 로만 그린다(판정은 서버가 한다).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/** GET /api/admin/mcp/servers/user-owned 항목(관리자 전용 응답 — shared-types 에 없음). */
interface UserOwnedServer {
  id: string;
  name: string;
  transport_type: string;
  owner_user_id: string;
  owner_email: string | null;
  sandbox_bridge_allowed: boolean;
  effective_network: "egress" | "bridge" | "none" | null;
}

const NETWORK_LABEL_KEY = {
  egress: "networkEgress",
  bridge: "networkBridge",
  none: "networkNone",
} as const;

export function AdminUserServersPanel() {
  const t = useTranslations("mcpMonitoring");
  const [items, setItems] = useState<UserOwnedServer[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApiEnvelope<{ items: UserOwnedServer[] }>>(
        "/api/admin/mcp/servers/user-owned",
      );
      setItems(res?.data?.items ?? []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (s: UserOwnedServer) => {
    if (confirmId !== s.id) {
      setConfirmId(s.id);
      return;
    }
    setConfirmId(null);
    setBusyId(s.id);
    try {
      await ApiClient.patch(`/api/admin/mcp/servers/${encodeURIComponent(s.id)}/sandbox-bridge`, {
        allowed: !s.sandbox_bridge_allowed,
      });
      setAppliedId(s.id);
      await load();
    } catch {
      setLoadError(true);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>{t("userServersTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <p className="px-5 pb-3 text-xs text-muted">{t("userServersHint")}</p>
        {loadError && <p className="px-5 pb-3 text-sm text-danger">{t("userServersError")}</p>}
        <Table>
          <thead>
            <tr>
              <Th>{t("colOwner")}</Th>
              <Th>{t("colName")}</Th>
              <Th>{t("colTransport")}</Th>
              <Th>{t("colNetwork")}</Th>
              <Th>{t("colBridge")}</Th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <Td className="py-8 text-center text-sm text-muted" colSpan={5}>
                  {t("userServersEmpty")}
                </Td>
              </tr>
            )}
            {items.map((s) => {
              const stdio = s.transport_type === "stdio";
              const label = s.effective_network ? t(NETWORK_LABEL_KEY[s.effective_network]) : "—";
              return (
                <tr key={s.id} className="transition hover:bg-surface-2">
                  <Td className="text-xs text-fg-2">{s.owner_email ?? s.owner_user_id}</Td>
                  <Td className="font-mono text-xs text-fg-2">{s.name}</Td>
                  <Td className="font-mono text-xs text-muted">{s.transport_type}</Td>
                  <Td className="text-xs">{label}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={confirmId === s.id ? "danger" : "outline"}
                        size="sm"
                        disabled={!stdio || busyId === s.id}
                        onClick={() => void toggle(s)}
                      >
                        {confirmId === s.id
                          ? t("bridgeConfirm")
                          : s.sandbox_bridge_allowed
                            ? t("bridgeRevoke")
                            : t("bridgeAllow")}
                      </Button>
                      {appliedId === s.id && (
                        <span className="text-xs text-muted">{t("bridgeApplied")}</span>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
