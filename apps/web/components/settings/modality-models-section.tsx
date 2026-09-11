"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Loader2, RotateCcw } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { fetchModels, type ModelEntry } from "@/lib/models-api";

/* ── 타입 (백엔드 /api/users/me/modality-models 응답) ─────────── */
export interface ModalityOverride {
  scope: string;
  modality: string;
  fullId: string;
  params: Record<string, string>;
  updatedAt: string;
}

export type ModalitySource = "user" | "global" | "default";

export interface ModalityEffective {
  modality: string;
  fullId?: string;
  source?: ModalitySource;
  error?: string;
  code?: string;
}

interface ModalityModelsPayload {
  overrides: ModalityOverride[];
  effective: ModalityEffective[];
  assignableModalities: string[];
}

/** 배정 미지정 select 값 — 전역/기본값으로 자동 해석됨 */
const DEFAULT_VALUE = "";

const SOURCE_TONE: Record<ModalitySource, "accent" | "success" | "neutral"> = {
  user: "accent",
  global: "success",
  default: "neutral",
};

/** 사용자·관리자 섹션이 공유하는 실효 값 표시 (fullId + source 배지, 오류 시 경고 배지). */
export function ModalityEffectiveLine({
  eff,
  t,
}: {
  eff: ModalityEffective | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!eff) return null;
  if (eff.error) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="warn" className="shrink-0 whitespace-nowrap">
          {t("unavailableBadge")}
        </Badge>
        <span className="text-warn">{eff.error}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <span className="break-all font-mono">{eff.fullId ?? "—"}</span>
      {eff.source && (
        <Badge tone={SOURCE_TONE[eff.source]} className="shrink-0 whitespace-nowrap">
          {t(`source.${eff.source}`)}
        </Badge>
      )}
    </div>
  );
}

/**
 * 모달리티별 모델 배정 — 설정 '모델' 탭.
 * "역할별 모델 배정"(어떤 텍스트 LLM 이 agent/judge 등을 맡는가)과 별개 축으로,
 * 이미지 생성·비전·영상·STT·TTS·임베딩을 어느 모델이 처리하는지 정한다.
 * 호출은 전부 LiteLLM 게이트웨이로 가므로 외부 모델은 게이트웨이 편입 provider 만 배정 가능
 * (서버가 400 으로 거절 — 사유 문자열을 그대로 표시).
 */
export function ModalityModelsSection() {
  const t = useTranslations("modalityModels");
  const [overrides, setOverrides] = useState<ModalityOverride[]>([]);
  const [effective, setEffective] = useState<ModalityEffective[]>([]);
  const [modalities, setModalities] = useState<string[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, modelsRes] = await Promise.all([
        ApiClient.get<ApiSuccess<ModalityModelsPayload>>("/api/users/me/modality-models"),
        // 역할 배정과 달리 채팅 불가 모델(임베딩·이미지 등)이 배정 대상이므로 필터 없이 전체 목록.
        fetchModels(),
      ]);
      setOverrides(res?.data?.overrides ?? []);
      setEffective(res?.data?.effective ?? []);
      setModalities(res?.data?.assignableModalities ?? []);
      setModels(modelsRes.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
      setOverrides([]);
      setEffective([]);
      setModalities([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleChange(modality: string, fullId: string) {
    setSaving(modality);
    setError(null);
    try {
      if (fullId === DEFAULT_VALUE) {
        // 오버라이드가 있을 때만 해제 (없으면 404 — 이미 기본 상태)
        if (overrides.some((o) => o.modality === modality)) {
          await ApiClient.del(`/api/users/me/modality-models/${modality}`);
        }
      } else {
        // params 는 1차 UI 없음 — 보내지 않는다.
        await ApiClient.put(`/api/users/me/modality-models/${modality}`, { model: fullId });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(null);
    }
  }

  const mapped = new Map(overrides.map((o) => [o.modality, o.fullId]));
  const effectiveMap = new Map(effective.map((e) => [e.modality, e]));

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
        <p className="text-xs text-muted">{t("axisNote")}</p>
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
          <div className="space-y-3">
            {modalities.map((modality) => {
              const current = mapped.get(modality) ?? DEFAULT_VALUE;
              const isSaving = saving === modality;
              return (
                <div
                  key={modality}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-sm font-medium">
                        {t(`modalities.${modality}`)}
                      </span>
                      {current !== DEFAULT_VALUE && (
                        <Badge tone="accent" className="shrink-0 whitespace-nowrap">
                          {t("assignedBadge")}
                        </Badge>
                      )}
                    </div>
                    <ModalityEffectiveLine eff={effectiveMap.get(modality)} t={t} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isSaving && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
                    )}
                    <select
                      className="h-9 min-w-52 rounded-md border border-border-strong bg-surface px-2 text-sm text-fg outline-none focus:border-accent"
                      value={current}
                      disabled={isSaving}
                      aria-label={t(`modalities.${modality}`)}
                      onChange={(e) => void handleChange(modality, e.target.value)}
                    >
                      <option value={DEFAULT_VALUE}>{t("defaultOption")}</option>
                      {/* 저장값이 목록 밖이면 값을 보존하는 옵션을 덧붙여 실제 배정을 표시
                          (model-roles-section 의 "(목록에 없음)" 규칙과 동일). */}
                      {current !== DEFAULT_VALUE &&
                        !models.some((m) => m.modelId === current) && (
                          <option value={current}>
                            {current} {t("notInList")}
                          </option>
                        )}
                      {models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.name}
                          {m.provider !== "local-llm" ? ` (${m.provider})` : ""}
                        </option>
                      ))}
                    </select>
                    {current !== DEFAULT_VALUE && !isSaving && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("resetLabel")}
                        title={t("resetLabel")}
                        onClick={() => void handleChange(modality, DEFAULT_VALUE)}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {modalities.length === 0 && !error && (
              <p className="text-sm text-muted">{t("empty")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
