"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Loader2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { fetchModels, type ModelEntry } from "@/lib/models-api";
import { compactParams, DEFAULT_VALUE, type CapabilityEffective, type CapabilityOverride } from "./capability-shared";
import { CapabilityGroupsEditor } from "./capability-groups";

// 관리자 페이지 등 기존 import 경로 호환 — 공용 조각은 capability-shared.tsx 가 SoT
export {
  CapabilityEffectiveLine, CapabilityParamsInputs, CapabilityUnsupportedBadge, compactParams, paramsEqual,
  CAPABILITY_PARAM_KEYS, CAPABILITY_PARAM_VALUE_MAX, UNSUPPORTED_CAPABILITIES,
  type CapabilityEffective, type CapabilityOverride, type CapabilitySource,
} from "./capability-shared";

interface CapabilityModelsPayload {
  overrides: CapabilityOverride[];
  effective: CapabilityEffective[];
  assignableCapabilities: string[];
}

/**
 * 기능(capability)별 모델 배정 — 설정 '모델' 탭.
 * "역할별 모델 배정"(어떤 텍스트 LLM 이 답하는가)과 별개 축으로, Planner 가 계획한
 * capability(추론·코드·이미지 생성·비전·STT·TTS·임베딩·영상 등)를 어느 모델이 처리할지 정한다.
 * 호출은 전부 LiteLLM 게이트웨이로 가므로 외부 모델은 게이트웨이 편입 provider 만 배정 가능
 * (서버가 400 으로 거절 — 사유 문자열을 그대로 표시).
 */
export function CapabilityModelsSection() {
  const t = useTranslations("capabilityModels");
  const [overrides, setOverrides] = useState<CapabilityOverride[]>([]);
  const [effective, setEffective] = useState<CapabilityEffective[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [paramDrafts, setParamDrafts] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, modelsRes] = await Promise.all([
        ApiClient.get<ApiSuccess<CapabilityModelsPayload>>("/api/users/me/capability-models"),
        // 역할 배정과 달리 채팅 불가 모델(임베딩·이미지 등)이 배정 대상이므로 필터 없이 전체 목록.
        fetchModels(),
      ]);
      const nextOverrides = res?.data?.overrides ?? [];
      setOverrides(nextOverrides);
      // 저장된 params 를 초안으로 되돌린다(적용 뒤 dirty 표시가 사라지도록).
      const drafts: Record<string, Record<string, string>> = {};
      for (const o of nextOverrides) drafts[o.capability] = { ...(o.params ?? {}) };
      setParamDrafts(drafts);
      setEffective(res?.data?.effective ?? []);
      setCapabilities(res?.data?.assignableCapabilities ?? []);
      setModels(modelsRes.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
      setOverrides([]);
      setEffective([]);
      setCapabilities([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  /** 그룹(여러 capability) 또는 단일 capability 에 같은 모델을 배정/해제한다 — 실패한 항목이 있어도 나머지는 반영되고 사유를 표시 */
  async function assign(caps: string[], fullId: string, busyKey: string) {
    setSaving(busyKey);
    setError(null);
    const failures: string[] = [];
    for (const capability of caps) {
      try {
        if (fullId === DEFAULT_VALUE) {
          if (overrides.some((o) => o.capability === capability)) await ApiClient.del(`/api/users/me/capability-models/${capability}`);
        } else {
          const params = compactParams(paramDrafts[capability]);
          await ApiClient.put(`/api/users/me/capability-models/${capability}`, { model: fullId, ...(params ? { params } : {}) });
        }
      } catch (e) {
        failures.push(`${capability}: ${e instanceof Error ? e.message : t("saveFailed")}`);
      }
    }
    await load();
    if (failures.length > 0) setError(failures.join(" · "));
    setSaving(null);
  }

  function setParam(capability: string, key: string, value: string) {
    setParamDrafts((d) => ({ ...d, [capability]: { ...(d[capability] ?? {}), [key]: value } }));
  }

  const mapped = new Map(overrides.map((o) => [o.capability, o.fullId]));
  const savedParams = new Map(overrides.map((o) => [o.capability, o.params]));
  const effectiveMap = new Map(effective.map((e) => [e.capability, e]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="h-4 w-4" aria-hidden />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted">{t("description")}</p>
        <p className="text-xs text-muted">{t("gatewayNote")}</p>

        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : (
          <CapabilityGroupsEditor
            t={t}
            capabilities={capabilities}
            mapped={mapped}
            savedParams={savedParams}
            effectiveMap={effectiveMap}
            models={models}
            busy={saving}
            paramDrafts={paramDrafts}
            onAssign={(caps, fullId, key) => void assign(caps, fullId, key)}
            onParamChange={setParam}
            onParamApply={(capability) => void assign([capability], mapped.get(capability) ?? DEFAULT_VALUE, capability)}
            labels={{ assigned: t("assignedBadge") }}
          />
        )}
        {!loading && capabilities.length === 0 && !error && (
          <p className="text-sm text-muted">{t("empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
