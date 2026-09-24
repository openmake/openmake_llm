"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Cpu, Loader2, RotateCcw, Save } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Input,
  NativeSelect,
} from "@/components/ui/primitives";
import type {
  ApiSuccess,
  ModelAssignmentsResponse,
  ModelSlotEffective,
  ModelSlotInfo,
} from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { fetchModels, type ModelEntry } from "@/lib/models-api";
import {
  DEFAULT_VALUE,
  GROUP_ORDER,
  PARAM_VALUE_MAX_CHARS,
  SELECT_MIN_WIDTH_CLASS,
} from "./model-assignments-constants";

/**
 * 모델 배정 — 역할별(ModelRole)·기능별(Capability) 배정을 합친 **단일 슬롯 배정** 화면.
 * 사용자 설정('모델' 탭)과 관리자 전역(/admin/model-roles)이 scope 만 달리해 같은 컴포넌트를 쓴다.
 * - kind='text' 슬롯은 채팅 가능 모델(usableOnly) 목록에서, kind='modality' 슬롯은 전체 목록에서 고른다
 *   (역할 배정은 소형·비채팅 모델을 걸렀고, 기능 배정은 임베딩·이미지 등 비채팅 모델도 골라야 하기 때문 —
 *    CLAUDE.md "역할 배정 모델 필터").
 * 계약: packages/shared-types/src/model-assignments.ts, 슬롯: apps/api/src/config/model-slots.ts.
 */
export function ModelAssignmentsSection({ scope }: { scope: "user" | "global" }) {
  const t = useTranslations("modelAssignments");
  const base =
    scope === "global"
      ? "/api/admin/model-assignments"
      : "/api/users/me/model-assignments";

  const [data, setData] = useState<ModelAssignmentsResponse | null>(null);
  const [textModels, setTextModels] = useState<ModelEntry[]>([]);
  const [modalityModels, setModalityModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 슬롯별 params 초안 — 저장 후 다시 로드하면 dirty 표시가 사라지도록 서버값으로 되돌린다.
  const [paramDrafts, setParamDrafts] = useState<Record<string, Record<string, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, usable, all] = await Promise.all([
        ApiClient.get<ApiSuccess<ModelAssignmentsResponse>>(base),
        fetchModels({ usableOnly: true }),
        fetchModels(),
      ]);
      const payload = res?.data ?? null;
      setData(payload);
      const drafts: Record<string, Record<string, string>> = {};
      for (const a of payload?.assignments ?? []) {
        drafts[a.slot] = toStringMap(a.params);
      }
      setParamDrafts(drafts);
      setTextModels(usable.models);
      setModalityModels(all.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const assignments = useMemo(
    () => new Map((data?.assignments ?? []).map((a) => [a.slot, a])),
    [data],
  );
  const effective = useMemo(
    () => new Map((data?.effective ?? []).map((e) => [e.slot, e])),
    [data],
  );

  /** 슬롯에 모델을 배정(fullId) 하거나 해제(DEFAULT_VALUE)한다. params 는 초안에서 비어있지 않은 값만 보낸다. */
  async function assign(slot: ModelSlotInfo, fullId: string) {
    setBusySlot(slot.id);
    setError(null);
    try {
      if (fullId === DEFAULT_VALUE) {
        if (assignments.has(slot.id)) await ApiClient.del(`${base}/${slot.id}`);
      } else {
        const params = compactParams(paramDrafts[slot.id]);
        await ApiClient.put(`${base}/${slot.id}`, {
          model: fullId,
          ...(params ? { params } : {}),
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusySlot(null);
    }
  }

  function setParam(slot: string, key: string, value: string) {
    setParamDrafts((d) => ({ ...d, [slot]: { ...(d[slot] ?? {}), [key]: value } }));
  }

  // 서버 slots 는 화면 순서. 그룹 묶음 순서만 GROUP_ORDER 로 고정한다.
  const groups = GROUP_ORDER.map((group) => ({
    group,
    slots: (data?.slots ?? []).filter((s) => s.group === group),
  })).filter((g) => g.slots.length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-4 w-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <p className="mt-1 text-xs text-muted">
          {t(scope === "global" ? "descriptionGlobal" : "description")}
        </p>
        <p className="mt-0.5 text-xs text-muted">{t("externalNote")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
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
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <div className="space-y-5">
            {groups.map(({ group, slots }) => (
              <div key={group} className="space-y-2">
                <div>
                  <h4 className="text-sm font-medium text-fg">{t(`groups.${group}`)}</h4>
                  <p className="text-xs text-muted">{t(`groupDesc.${group}`)}</p>
                </div>
                <div className="space-y-2">
                  {slots.map((slot) => (
                    <SlotRow
                      key={slot.id}
                      slot={slot}
                      models={slot.kind === "modality" ? modalityModels : textModels}
                      assigned={assignments.get(slot.id)?.fullId ?? DEFAULT_VALUE}
                      eff={effective.get(slot.id)}
                      draft={paramDrafts[slot.id] ?? {}}
                      saved={toStringMap(assignments.get(slot.id)?.params ?? {})}
                      busy={busySlot === slot.id}
                      disabledAll={busySlot !== null}
                      onAssign={(fullId) => void assign(slot, fullId)}
                      onParamChange={(key, v) => setParam(slot.id, key, v)}
                      onParamApply={() =>
                        void assign(slot, assignments.get(slot.id)?.fullId ?? DEFAULT_VALUE)
                      }
                      t={t}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {scope === "global" && !loading && (
          <p className="text-xs text-muted">{t("cacheNote")}</p>
        )}
      </CardContent>
    </Card>
  );
}

/* ── 한 슬롯 행 ─────────────────────────────────────────── */

const SOURCE_TONE = {
  user: "accent",
  global: "success",
  default: "neutral",
  none: "warn",
} as const;

function slotKey(id: string): string {
  return id.replace(/\./g, "_");
}

function SlotRow({
  slot,
  models,
  assigned,
  eff,
  draft,
  saved,
  busy,
  disabledAll,
  onAssign,
  onParamChange,
  onParamApply,
  t,
}: {
  slot: ModelSlotInfo;
  models: ModelEntry[];
  assigned: string;
  eff: ModelSlotEffective | undefined;
  draft: Record<string, string>;
  saved: Record<string, string>;
  busy: boolean;
  disabledAll: boolean;
  onAssign: (fullId: string) => void;
  onParamChange: (key: string, value: string) => void;
  onParamApply: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const key = slotKey(slot.id);
  const label = t(`slots.${key}.title`);
  const unavailable = !slot.available;
  const selectDisabled = disabledAll || unavailable;
  const dirty =
    assigned !== DEFAULT_VALUE && slot.paramKeys.length > 0 && !paramsEqual(saved, draft);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{label}</span>
          {assigned !== DEFAULT_VALUE && (
            <Badge tone="accent" className="shrink-0 whitespace-nowrap">
              {t("assignedBadge")}
            </Badge>
          )}
          {/* 구조적 미가용(어댑터 없음·add-on 꺼짐)만 여기서 표시 — 해석 오류는 EffectiveLine 이 사유와 함께 낸다 */}
          {unavailable && !eff?.error && (
            <Badge tone="warn" className="shrink-0 whitespace-nowrap">
              {t("unavailableBadge")}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted">{t(`slots.${key}.description`)}</p>
        <EffectiveLine eff={eff} t={t} />
        {slot.paramKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {slot.paramKeys.map((pk) => (
              <Input
                key={pk}
                inputSize="sm"
                type="text"
                className="w-28 bg-surface-2 font-mono"
                placeholder={pk}
                title={pk}
                aria-label={`${label} ${pk}`}
                maxLength={PARAM_VALUE_MAX_CHARS}
                value={draft[pk] ?? ""}
                disabled={assigned === DEFAULT_VALUE || busy || disabledAll}
                onChange={(e) => onParamChange(pk, e.target.value)}
              />
            ))}
            {dirty && (
              <Button
                size="sm"
                variant="ghost"
                className="whitespace-nowrap"
                disabled={busy || disabledAll}
                onClick={onParamApply}
              >
                <Save className="h-4 w-4" aria-hidden />
                {t("paramsApply")}
              </Button>
            )}
            <span className="text-xs text-muted">{t("paramsHint")}</span>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
        <NativeSelect
          className={`w-auto ${SELECT_MIN_WIDTH_CLASS}`}
          value={assigned}
          disabled={selectDisabled}
          aria-label={label}
          onChange={(e) => onAssign(e.target.value)}
        >
          <option value={DEFAULT_VALUE}>{t("defaultOption")}</option>
          {/* 저장된 배정이 필터된 목록 밖이면 값을 보존하는 옵션을 덧붙인다(구 model-roles 규칙) */}
          {assigned !== DEFAULT_VALUE && !models.some((m) => m.modelId === assigned) && (
            <option value={assigned}>
              {assigned} {t("notInList")}
            </option>
          )}
          {models.map((m) => (
            <option key={m.modelId} value={m.modelId}>
              {m.name}
              {m.provider !== "local-llm" ? ` (${m.provider})` : ""}
            </option>
          ))}
        </NativeSelect>
        {assigned !== DEFAULT_VALUE && !disabledAll && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("resetLabel")}
            title={t("resetLabel")}
            onClick={() => onAssign(DEFAULT_VALUE)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}

/** 실효 값 표시 — fullId + source 배지. 오류가 있으면 경고 문구. */
function EffectiveLine({
  eff,
  t,
}: {
  eff: ModelSlotEffective | undefined;
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
      <Badge tone={SOURCE_TONE[eff.source]} className="shrink-0 whitespace-nowrap">
        {t(`source.${eff.source}`)}
      </Badge>
    </div>
  );
}

/* ── params 유틸 ────────────────────────────────────────── */

function toStringMap(params: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(params ?? {})) out[k] = v == null ? "" : String(v);
  return out;
}

/** 비어 있지 않은(trim) 값만 남긴 params — PUT body 용. 없으면 undefined. */
function compactParams(draft: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!draft) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft)) {
    const s = v.trim();
    if (s) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 저장값과 초안이 같은지 (빈 값은 없는 것으로 취급) */
function paramsEqual(
  saved: Record<string, string> | undefined,
  draft: Record<string, string> | undefined,
): boolean {
  const a = compactParams(saved) ?? {};
  const b = compactParams(draft) ?? {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return false;
  return true;
}
