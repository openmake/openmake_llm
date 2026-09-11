"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Layers, Loader2, RotateCcw, Save } from "lucide-react";
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

/* ── 타입 (백엔드 /api/users/me/capability-models 응답) ─────────── */
export interface CapabilityOverride {
  scope: string;
  capability: string;
  fullId: string;
  params: Record<string, string>;
  updatedAt: string;
}

export type CapabilitySource = "user" | "global" | "default";

export interface CapabilityEffective {
  capability: string;
  fullId?: string;
  source?: CapabilitySource;
  error?: string;
  code?: string;
}

interface CapabilityModelsPayload {
  overrides: CapabilityOverride[];
  effective: CapabilityEffective[];
  assignableCapabilities: string[];
}

/** 배정 미지정 select 값 — 전역/기본값으로 자동 해석됨 */
const DEFAULT_VALUE = "";

/**
 * capability 별 params 화이트리스트 — 백엔드 capability 설정의 PARAM_KEYS 와
 * 동일하게 유지할 것(서버는 이 키 밖의 값을 조용히 버린다).
 */
export const CAPABILITY_PARAM_KEYS: Record<string, readonly string[]> = {
  "text.reason": ["temperature"],
  "text.code": ["temperature"],
  "text.embed": ["dimensions"],
  "vision.describe": ["detail"],
  "vision.ocr": ["detail"],
  "image.generate": ["size", "quality", "style"],
  "image.edit": ["size"],
  "audio.transcribe": ["language"],
  "audio.speech": ["voice", "format"],
  "music.generate": ["duration"],
  "video.generate": ["size", "seconds"],
};

/**
 * provider 어댑터가 아직 없는 capability — 배정은 가능하지만 실행 경로가 없어
 * "현재 미지원" 배지를 보여 준다(백엔드 어댑터가 생기면 여기서 제거).
 */
export const UNSUPPORTED_CAPABILITIES: ReadonlySet<string> = new Set([
  "audio.analyze",
  "music.analyze",
  "music.generate",
  "video.analyze",
]);

/** 백엔드 `PARAM_VALUE_MAX_CHARS` 와 동일 */
export const CAPABILITY_PARAM_VALUE_MAX = 64;

/** 비어 있지 않은(trim) 값만 남긴 params — PUT body 용. 없으면 undefined. */
export function compactParams(draft: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!draft) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft)) {
    const s = v.trim();
    if (s) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 저장된 params 와 초안이 같은지 (빈 값은 없는 것으로 취급) */
export function paramsEqual(saved: Record<string, string> | undefined, draft: Record<string, string> | undefined): boolean {
  const a = compactParams(saved) ?? {};
  const b = compactParams(draft) ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * capability params 입력 행 (사용자·관리자 공용). 허용 키마다 작은 텍스트 입력 하나.
 * 모델이 배정되지 않았으면 비활성, 저장값과 다를 때만 [적용] 버튼 노출.
 */
export function CapabilityParamsInputs({
  capability,
  draft,
  saved,
  disabled,
  busy,
  onChange,
  onApply,
  t,
}: {
  capability: string;
  draft: Record<string, string>;
  saved: Record<string, string> | undefined;
  disabled: boolean;
  busy: boolean;
  onChange: (key: string, value: string) => void;
  onApply: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const keys = CAPABILITY_PARAM_KEYS[capability] ?? [];
  if (keys.length === 0) return null;
  const dirty = !disabled && !paramsEqual(saved, draft);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {keys.map((key) => (
        <input
          key={key}
          type="text"
          className="h-8 w-28 rounded-md border border-border bg-surface-2 px-2 font-mono text-xs text-fg placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50"
          placeholder={key}
          title={key}
          aria-label={`${t(`capabilities.${capability.replace(/\./g, '_')}`)} ${key}`}
          maxLength={CAPABILITY_PARAM_VALUE_MAX}
          value={draft[key] ?? ""}
          disabled={disabled || busy}
          onChange={(e) => onChange(key, e.target.value)}
        />
      ))}
      {dirty && (
        <Button size="sm" variant="ghost" className="whitespace-nowrap" disabled={busy} onClick={onApply}>
          <Save className="h-4 w-4" aria-hidden />
          {t("paramsApply")}
        </Button>
      )}
      <span className="text-xs text-muted">{t("paramsHint")}</span>
    </div>
  );
}

const SOURCE_TONE: Record<CapabilitySource, "accent" | "success" | "neutral"> = {
  user: "accent",
  global: "success",
  default: "neutral",
};

/** 사용자·관리자 섹션이 공유하는 실효 값 표시 (fullId + source 배지, 오류 시 경고 배지). */
export function CapabilityEffectiveLine({
  eff,
  t,
}: {
  eff: CapabilityEffective | undefined;
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

/** 어댑터 미구현 capability 배지 (사용자·관리자 공용). */
export function CapabilityUnsupportedBadge({
  capability,
  t,
}: {
  capability: string;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!UNSUPPORTED_CAPABILITIES.has(capability)) return null;
  return (
    <Badge tone="neutral" className="shrink-0 whitespace-nowrap" title={t("unsupportedHint")}>
      {t("unsupportedBadge")}
    </Badge>
  );
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

  async function handleChange(capability: string, fullId: string) {
    setSaving(capability);
    setError(null);
    try {
      if (fullId === DEFAULT_VALUE) {
        // 오버라이드가 있을 때만 해제 (없으면 404 — 이미 기본 상태)
        if (overrides.some((o) => o.capability === capability)) {
          await ApiClient.del(`/api/users/me/capability-models/${capability}`);
        }
      } else {
        const params = compactParams(paramDrafts[capability]);
        await ApiClient.put(`/api/users/me/capability-models/${capability}`, {
          model: fullId,
          ...(params ? { params } : {}),
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(null);
    }
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
          <div className="space-y-3">
            {capabilities.map((capability) => {
              const current = mapped.get(capability) ?? DEFAULT_VALUE;
              const isSaving = saving === capability;
              return (
                <div
                  key={capability}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="whitespace-nowrap text-sm font-medium">
                        {t(`capabilities.${capability.replace(/\./g, '_')}`)}
                      </span>
                      <span className="font-mono text-xs text-muted">{capability}</span>
                      {current !== DEFAULT_VALUE && (
                        <Badge tone="accent" className="shrink-0 whitespace-nowrap">
                          {t("assignedBadge")}
                        </Badge>
                      )}
                      <CapabilityUnsupportedBadge capability={capability} t={t} />
                    </div>
                    <CapabilityEffectiveLine eff={effectiveMap.get(capability)} t={t} />
                    <CapabilityParamsInputs
                      capability={capability}
                      draft={paramDrafts[capability] ?? {}}
                      saved={savedParams.get(capability)}
                      disabled={current === DEFAULT_VALUE}
                      busy={isSaving}
                      onChange={(key, value) => setParam(capability, key, value)}
                      onApply={() => void handleChange(capability, current)}
                      t={t}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isSaving && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />
                    )}
                    <select
                      className="h-9 min-w-52 rounded-md border border-border-strong bg-surface px-2 text-sm text-fg outline-none focus:border-accent"
                      value={current}
                      disabled={isSaving}
                      aria-label={t(`capabilities.${capability.replace(/\./g, '_')}`)}
                      onChange={(e) => void handleChange(capability, e.target.value)}
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
                        onClick={() => void handleChange(capability, DEFAULT_VALUE)}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {capabilities.length === 0 && !error && (
              <p className="text-sm text-muted">{t("empty")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
