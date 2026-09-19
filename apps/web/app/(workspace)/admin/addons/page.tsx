"use client";

/**
 * /admin/addons — Add-on 설치 목록과 상태 토글 (S3, 2026-09-19).
 *
 * 켜고 끄기는 `addon_installations.state` 를 바꾼다. 라우트 노출과 사용권은 즉시 반영되고,
 * 런타임 등록(도구·스킬 주입·채팅 모드)은 부팅 시점이라 재시작이 필요하다 — 그 사실을 화면이 그대로 알린다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Blocks, Power, PowerOff, AlertTriangle, Cpu } from "lucide-react";
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

interface ProfileRow {
  id: string;
  displayName: string;
  contextLength: number | null;
  contextLengthProbed: boolean;
  available: boolean;
  licenseBlockReason: string | null;
  profile: {
    capabilities?: { toolCalling?: boolean; thinking?: boolean; vision?: boolean };
    reasoningEfforts?: string[];
    toolStrict?: boolean;
    maxPromptImages?: number;
    license?: { id: string; commercialUse: boolean };
  };
}
type ProfilePayload = ApiSuccess<{ profiles: ProfileRow[] }>;

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
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  const load = useCallback(async () => {
    try {
      const [r, p] = await Promise.all([
        ApiClient.get<Payload>("/api/admin/addons"),
        ApiClient.get<ProfilePayload>("/api/admin/model-profiles"),
      ]);
      setAddons(r?.data?.addons ?? []);
      setRestartNote(r?.data?.restartNote ?? "");
      setProfiles(p?.data?.profiles ?? []);
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
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> {t("profilesTitle")}</CardTitle></CardHeader>
            <CardContent>
              <p className="mb-2 text-[11px] text-muted">{t("profilesHelp")}</p>
              {profiles.length === 0 ? <p className="text-xs text-muted">{t("empty")}</p> : (
                <div className="overflow-x-auto">
                  <Table>
                    <thead>
                      <tr><Th>{t("model")}</Th><Th>{t("context")}</Th><Th>{t("capabilities")}</Th><Th>{t("efforts")}</Th><Th>{t("license")}</Th></tr>
                    </thead>
                    <tbody>
                      {profiles.map((p) => (
                        <tr key={p.id}>
                          <Td>
                            <div className="font-mono text-xs">{p.id}</div>
                            {!p.available && <div className="text-[11px] text-warn">{t("unavailable")}</div>}
                          </Td>
                          <Td className="text-xs">
                            {p.contextLength ? p.contextLength.toLocaleString() : "—"}
                            {p.contextLengthProbed && <span className="ml-1 text-[11px] text-muted">{t("probed")}</span>}
                          </Td>
                          <Td className="text-xs">
                            {[p.profile.capabilities?.toolCalling && "tools", p.profile.capabilities?.thinking && "thinking", p.profile.capabilities?.vision && "vision"]
                              .filter(Boolean).join(" · ") || "—"}
                            {p.profile.toolStrict !== undefined && <span className="ml-1 text-muted">· strict={String(p.profile.toolStrict)}</span>}
                            {p.profile.maxPromptImages !== undefined && <span className="ml-1 text-muted">· img≤{p.profile.maxPromptImages}</span>}
                          </Td>
                          <Td className="font-mono text-[11px]">{p.profile.reasoningEfforts?.join(", ") ?? "—"}</Td>
                          <Td className="text-xs">
                            {p.profile.license ? `${p.profile.license.id}${p.profile.license.commercialUse ? "" : ` (${t("nonCommercial")})`}` : "—"}
                            {p.licenseBlockReason && <div className="text-[11px] text-danger">{p.licenseBlockReason}</div>}
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
