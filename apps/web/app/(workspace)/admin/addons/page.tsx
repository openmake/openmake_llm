"use client";

/**
 * /admin/addons — Add-on 설치 목록과 상태 토글 (S3, 2026-09-19).
 *
 * 켜고 끄기는 `addon_installations.state` 를 바꾼다. 라우트 노출과 사용권은 즉시 반영되고,
 * 런타임 등록(도구·스킬 주입·채팅 모드)은 부팅 시점이라 재시작이 필요하다 — 그 사실을 화면이 그대로 알린다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Blocks, Power, PowerOff, AlertTriangle } from "lucide-react";
import { PageHeader, Card, CardHeader, CardTitle, CardContent, Button, Table, Th, Td, Badge } from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

type AddonState = "installed" | "enabled" | "disabled" | "failed";

interface AddonRow {
  id: string;
  name: string;
  version: string;
  kind: string;
  enabledByEnv: boolean;
  state: AddonState;
  source: string;
  entitlementSku: string | null;
  failureReason: string | null;
  modelRequirement?: { ok: boolean; satisfiedBy: string[]; reason?: string };
}
type Payload = ApiSuccess<{ addons: AddonRow[]; restartNote: string }>;

const STATE_TONE: Record<AddonState, "success" | "warn" | "danger" | "neutral"> = {
  enabled: "success",
  installed: "neutral",
  disabled: "warn",
  failed: "danger",
};

export default function AdminAddonsPage() {
  const t = useTranslations("adminAddons");
  const [addons, setAddons] = useState<AddonRow[]>([]);
  const [restartNote, setRestartNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<Payload>("/api/admin/addons");
      setAddons(r?.data?.addons ?? []);
      setRestartNote(r?.data?.restartNote ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function setState(addon: AddonRow, state: AddonState) {
    setError(null);
    setBusy(addon.id);
    try {
      await ApiClient.patch(`/api/admin/addons/${encodeURIComponent(addon.id)}/state`, { state });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <AdminTabs />
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
          {error && <p className="text-sm text-danger" role="alert">{error}</p>}
          {restartNote && <p className="text-xs text-muted">{restartNote}</p>}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Blocks className="h-4 w-4" /> {t("listTitle")}</CardTitle></CardHeader>
            <CardContent>
              {addons.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>{t("addon")}</Th><Th>{t("kind")}</Th><Th>{t("source")}</Th>
                        <Th>{t("state")}</Th><Th>{t("entitlement")}</Th><Th>{t("modelRequirement")}</Th><Th></Th>
                      </tr>
                    </thead>
                    <tbody>
                      {addons.map((a) => (
                        <tr key={a.id}>
                          <Td>
                            <div className="font-medium">{a.name}</div>
                            <div className="font-mono text-[11px] text-muted">{a.id} · v{a.version}</div>
                          </Td>
                          <Td className="text-xs">{a.kind}</Td>
                          <Td className="text-xs">{a.source}</Td>
                          <Td>
                            <Badge tone={STATE_TONE[a.state]}>{t(`states.${a.state}`)}</Badge>
                            {!a.enabledByEnv && <div className="mt-1 text-[11px] text-warn">{t("envDisabled")}</div>}
                            {a.failureReason && <div className="mt-1 max-w-[22rem] truncate text-[11px] text-danger" title={a.failureReason}>{a.failureReason}</div>}
                          </Td>
                          <Td className="text-xs text-muted">{a.entitlementSku ?? t("entitlementFree")}</Td>
                          <Td className="text-xs">
                            {!a.modelRequirement ? "—" : a.modelRequirement.ok
                              ? <span className="text-muted">{a.modelRequirement.satisfiedBy.length > 0 ? t("modelOk", { count: a.modelRequirement.satisfiedBy.length }) : "—"}</span>
                              : <span className="flex items-center gap-1 text-danger"><AlertTriangle className="h-3.5 w-3.5" />{a.modelRequirement.reason}</span>}
                          </Td>
                          <Td>
                            {a.state === "enabled" ? (
                              <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void setState(a, "disabled")}>
                                <PowerOff className="h-3.5 w-3.5" /> {t("disable")}
                              </Button>
                            ) : (
                              <Button size="sm" variant="ghost" disabled={busy === a.id} onClick={() => void setState(a, "enabled")}>
                                <Power className="h-3.5 w-3.5" /> {t("enable")}
                              </Button>
                            )}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
