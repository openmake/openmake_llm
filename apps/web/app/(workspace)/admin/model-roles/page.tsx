"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UsersRound, KeyRound, Trash2, Save, Loader2, Layers } from "lucide-react";
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
import { fetchModels, type ModelEntry } from "@/lib/models-api";
import { compactParams, type CapabilityEffective, type CapabilityOverride } from "@/components/settings/capability-shared";
import { CapabilityGroupsEditor } from "@/components/settings/capability-groups";

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
/* 백엔드 /api/admin/capability-models */
interface CapabilityPayload {
  mappings: CapabilityOverride[];
  effective: CapabilityEffective[];
  capabilities: string[];
  assignableCapabilities: string[];
  defaults: Record<string, string>;
  gatewayProviders: string[];
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
      <p className="text-xs text-muted">{t("keyForm.dailyLimitHelp")}</p>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

/**
 * 전역 capability→모델 배정 — "역할&모델"(텍스트 LLM 이 어떤 역할을 맡는가)과 별개 축.
 * Planner 가 계획한 기능(추론·코드·이미지·비전·음성·영상·임베딩)을 처리할 모델을 전역 기본값으로 정한다.
 * 외부 모델은 게이트웨이 편입 provider 만 허용(서버 400 사유를 그대로 표시).
 */
function GlobalCapabilityModelsCard() {
  const t = useTranslations("adminCapabilityModels");
  const [payload, setPayload] = useState<CapabilityPayload | null>(null);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [paramDrafts, setParamDrafts] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, m] = await Promise.all([
        ApiClient.get<ApiSuccess<CapabilityPayload>>("/api/admin/capability-models"),
        // 채팅 불가 모델(임베딩·이미지)도 배정 대상 — 필터 없는 전체 목록.
        fetchModels(),
      ]);
      setPayload(r?.data ?? null);
      const drafts: Record<string, Record<string, string>> = {};
      for (const row of r?.data?.mappings ?? []) drafts[row.capability] = { ...(row.params ?? {}) };
      setParamDrafts(drafts);
      setModels(m.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  /** 그룹(여러 capability) 또는 단일 capability 에 같은 모델을 전역 배정/해제 — 실패 항목은 사유를 모아 표시 */
  async function assign(caps: string[], fullId: string, busyKey: string) {
    setBusy(busyKey);
    setError(null);
    const failures: string[] = [];
    for (const capability of caps) {
      try {
        if (fullId) {
          const params = compactParams(paramDrafts[capability]);
          await ApiClient.put(`/api/admin/capability-models/${capability}`, { model: fullId, ...(params ? { params } : {}) });
        } else if (payload?.mappings.some((m) => m.capability === capability)) {
          await ApiClient.del(`/api/admin/capability-models/${capability}`);
        }
      } catch (e) {
        failures.push(`${capability}: ${e instanceof Error ? e.message : t("saveFailed")}`);
      }
    }
    await load();
    if (failures.length > 0) setError(failures.join(" · "));
    setBusy(null);
  }

  function setParam(capability: string, key: string, value: string) {
    setParamDrafts((d) => ({ ...d, [capability]: { ...(d[capability] ?? {}), [key]: value } }));
  }

  const mapped = new Map((payload?.mappings ?? []).map((m) => [m.capability, m.fullId]));
  const savedParams = new Map((payload?.mappings ?? []).map((m) => [m.capability, m.params]));
  const effectiveMap = new Map((payload?.effective ?? []).map((e) => [e.capability, e]));
  const providers = payload?.gatewayProviders ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" aria-hidden />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted">{t("description")}</p>
        <p className="text-xs text-muted">{t("axisNote")}</p>
        <p className="text-xs text-muted">
          {t("gatewayNote", { providers: providers.length > 0 ? providers.join(", ") : t("gatewayNone") })}
        </p>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <CapabilityGroupsEditor
          t={t}
          admin
          capabilities={payload?.assignableCapabilities ?? []}
          mapped={mapped}
          savedParams={savedParams}
          effectiveMap={effectiveMap}
          models={models}
          busy={busy}
          paramDrafts={paramDrafts}
          codeDefaults={payload?.defaults}
          onAssign={(caps, fullId, key) => void assign(caps, fullId, key)}
          onParamChange={setParam}
          onParamApply={(capability) => void assign([capability], mapped.get(capability) ?? "", capability)}
          labels={{ assigned: t("assigned") }}
        />
        <p className="text-xs text-muted">{t("cacheNote")}</p>
      </CardContent>
    </Card>
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
    // 워크스페이스 레이아웃의 <main> 은 h-dvh + overflow-hidden 이라(채팅이 자체 스크롤 영역을
    // 갖는 전제) 페이지가 스크롤 컨테이너를 직접 만들어야 한다 — 없으면 본문이 뷰포트 밖에서
    // 통째로 잘린다(2026-09-13 신고: 1280×900 에서 1,314px 접근 불가). 헤더·탭은 고정.
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <AdminTabs />

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" aria-hidden />
            {t("serverKeys.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">{t("serverKeys.description")}</p>
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
          <p className="text-sm text-muted">{t("globalRoles.description")}</p>
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
          <p className="text-xs text-muted">{t("globalRoles.cacheNote")}</p>
        </CardContent>
      </Card>

      <GlobalCapabilityModelsCard />
      </div>
    </>
  );
}
