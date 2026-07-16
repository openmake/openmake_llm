"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UsersRound, KeyRound, Trash2, Save, Loader2 } from "lucide-react";
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

/* ── 타입 (백엔드 /api/admin/model-roles, /api/admin/server-external-keys) ── */
interface GlobalMapping {
  role: string;
  fullModelId: string;
  updatedAt: string;
}
interface RolesPayload {
  mappings: GlobalMapping[];
  roles: string[];
  envFallback: Record<string, string>;
}
interface ServerKeyRow {
  providerId: string;
  baseUrl: string | null;
  isActive: boolean;
  dailyTokenLimit: number;
  monthlyTokenLimit: number | null;
  updatedAt: string;
}
interface ServerKeysPayload {
  keys: ServerKeyRow[];
  providers: { id: string; displayName: string; defaultBaseUrl: string }[];
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";
const selectCls =
  "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

/** 서버 공용 키 등록 폼 */
function ServerKeyForm({ providers, onSaved }: {
  providers: ServerKeysPayload["providers"];
  onSaved: () => void;
}) {
  const t = useTranslations("adminModelRoles");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [dailyLimit, setDailyLimit] = useState("100000");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await ApiClient.put(`/api/admin/server-external-keys/${providerId}`, {
        apiKey,
        dailyTokenLimit: Number(dailyLimit),
      });
      setApiKey("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className={selectCls} value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label={t("keyForm.provider")}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
        <input
          className={inputCls}
          type="password"
          placeholder={t("keyForm.apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <input
          className={`${inputCls} sm:w-40`}
          type="number"
          min={0}
          title={t("keyForm.dailyLimit")}
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
        />
        <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={saving || apiKey.length < 8} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("keyForm.save")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t("keyForm.dailyLimitHelp")}</p>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}

/**
 * 전역 역할→모델 매핑(L3) + 서버 공용 외부 키 관리 — admin 전용.
 * 변경은 재시작 없이 최대 60초 내 반영(resolver 캐시).
 */
export default function AdminModelRolesPage() {
  const t = useTranslations("adminModelRoles");
  const [roles, setRoles] = useState<RolesPayload | null>(null);
  const [serverKeys, setServerKeys] = useState<ServerKeysPayload | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyRole, setBusyRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, k] = await Promise.all([
        ApiClient.get<ApiSuccess<RolesPayload>>("/api/admin/model-roles"),
        ApiClient.get<ApiSuccess<ServerKeysPayload>>("/api/admin/server-external-keys"),
      ]);
      setRoles(r?.data ?? null);
      setServerKeys(k?.data ?? null);
      const mapped: Record<string, string> = {};
      for (const m of r?.data?.mappings ?? []) mapped[m.role] = m.fullModelId;
      setDrafts(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function saveRole(role: string) {
    const model = (drafts[role] ?? "").trim();
    setBusyRole(role);
    setError(null);
    try {
      if (model) {
        await ApiClient.put(`/api/admin/model-roles/${role}`, { model });
      } else if (roles?.mappings.some((m) => m.role === role)) {
        await ApiClient.del(`/api/admin/model-roles/${role}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusyRole(null);
    }
  }

  async function deleteKey(providerId: string) {
    if (!window.confirm(t("keyDeleteConfirm", { provider: providerId }))) return;
    try {
      await ApiClient.del(`/api/admin/server-external-keys/${providerId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    }
  }

  const mappedRoles = new Set((roles?.mappings ?? []).map((m) => m.role));

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} description={t("description")} />

      <AdminTabs />
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" aria-hidden />
            {t("serverKeys.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("serverKeys.description")}</p>
          {serverKeys && serverKeys.keys.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>{t("serverKeys.provider")}</Th>
                  <Th>{t("serverKeys.dailyLimit")}</Th>
                  <Th>{t("serverKeys.status")}</Th>
                  <Th>{t("serverKeys.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {serverKeys.keys.map((k) => (
                  <tr key={k.providerId}>
                    <Td>{k.providerId}</Td>
                    <Td>{k.dailyTokenLimit.toLocaleString()}</Td>
                    <Td>
                      <Badge tone={k.isActive ? "success" : "neutral"}>
                        {k.isActive ? t("serverKeys.active") : t("serverKeys.inactive")}
                      </Badge>
                    </Td>
                    <Td>
                      <Button variant="ghost" size="sm" aria-label={t("serverKeys.delete")}
                        onClick={() => void deleteKey(k.providerId)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {serverKeys && <ServerKeyForm providers={serverKeys.providers} onSaved={() => void load()} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersRound className="h-4 w-4" aria-hidden />
            {t("globalRoles.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("globalRoles.description")}</p>
          {(roles?.roles ?? []).map((role) => (
            <div key={role} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-36 items-center gap-2">
                <span className="whitespace-nowrap text-sm font-medium">{role}</span>
                {mappedRoles.has(role) && <Badge tone="accent" className="shrink-0 whitespace-nowrap">{t("globalRoles.assigned")}</Badge>}
              </div>
              <input
                className={inputCls}
                placeholder={t("globalRoles.placeholder", { fallback: roles?.envFallback[role] ?? "" })}
                value={drafts[role] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [role]: e.target.value }))}
              />
              <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={busyRole === role} onClick={() => void saveRole(role)}>
                {busyRole === role
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  : <Save className="h-4 w-4" aria-hidden />}
                {t("globalRoles.save")}
              </Button>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t("globalRoles.cacheNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
