"use client";

/**
 * /admin/bridge-devices — 연결된 로컬 실행 기기(Companion·CLI) 전체 목록과 강제 해제 (2026-10-05).
 * 기기 목록은 API 프로세스 메모리에 있다. 폴더는 이름만 보인다(전체 경로는 서버가 싣지 않는다).
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MonitorSmartphone, RefreshCw, Unplug } from "lucide-react";
import { PageHeader, PageBody, Card, CardHeader, CardTitle, CardContent, Button, Table, Th, Td } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { AdminBridgeDevice, AdminBridgeDevicesResponse, AdminBridgeUserDevices, ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

export default function AdminBridgeDevicesPage() {
  const t = useTranslations("adminBridgeDevices");
  const locale = useLocale();
  const [data, setData] = useState<AdminBridgeDevicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<AdminBridgeDevicesResponse>>("/api/admin/local-bridge/devices");
      setData(r?.data ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : t("loadError")); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function disconnect(user: AdminBridgeUserDevices, d: AdminBridgeDevice) {
    if (!confirm(t("disconnectConfirm", { label: d.label, email: user.email ?? user.userId }))) return;
    const key = `${user.userId}/${d.deviceId}`;
    setBusy(key); setError(null);
    try {
      await ApiClient.post(`/api/admin/local-bridge/devices/${encodeURIComponent(d.deviceId)}/disconnect`, { userId: user.userId });
    } catch (e) { setError(e instanceof Error ? e.message : t("disconnectFailed")); }
    setBusy(null);
    await load();
  }

  const users = data?.users ?? [];
  const fmt = (ms: number) => new Date(ms).toLocaleString(locale);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <PageBody>
        <div className="space-y-6">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {data && !data.enabled && <p className="text-sm text-muted">{t("disabled")}</p>}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MonitorSmartphone className="h-4 w-4" /> {t("listTitle")}
                <Button size="sm" variant="ghost" className="ml-auto" aria-label={t("refresh")} onClick={() => void load()}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {users.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("user")}</Th><Th>{t("host")}</Th><Th>{t("label")}</Th><Th>{t("folder")}</Th>
                      <Th>{t("connectedAt")}</Th><Th>{t("capabilities")}</Th><Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.flatMap((u) => u.devices.map((d) => {
                      const key = `${u.userId}/${d.deviceId}`;
                      return (
                        <tr key={key}>
                          <Td className="text-xs">{u.email ?? u.userId}</Td>
                          <Td className="font-mono text-xs">{d.hostId}</Td>
                          <Td className="text-xs">{d.label}</Td>
                          <Td className="text-xs">{d.folderName || "—"}</Td>
                          <Td className="text-xs text-muted">{fmt(d.connectedAt)}</Td>
                          <Td className="text-[11px] text-muted">{d.capabilities.join(", ")}</Td>
                          <Td>
                            <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => void disconnect(u, d)}>
                              <Unplug className="h-3.5 w-3.5 text-danger" /> {t("disconnect")}
                            </Button>
                          </Td>
                        </tr>
                      );
                    }))}
                  </tbody>
                </Table>
              )}
              <p className="mt-3 text-[11px] text-muted">{t("reconnectNote")}</p>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}
