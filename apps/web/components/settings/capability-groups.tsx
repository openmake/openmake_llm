"use client";

import { useState } from "react";
import type { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight, Loader2, RotateCcw } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import type { ModelEntry } from "@/lib/models-api";
import {
  CapabilityEffectiveLine,
  CapabilityParamsInputs,
  CapabilityUnsupportedBadge,
  DEFAULT_VALUE,
  UNSUPPORTED_CAPABILITIES,
  type CapabilityEffective,
} from "./capability-shared";

/**
 * capability 그룹 — 사용자에게는 "무엇을 하는 모델인가" 단위로 보여 주고, 내부 capability(Planner·실행기 이름)는
 * 그룹 아래 "세부 설정" 에서만 개별 지정한다. 그룹 select 하나로 고르면 하위 capability 전부에 같은 모델을 배정한다.
 * 16종을 그대로 나열하던 화면이 과하게 세분화됐다는 지적(2026-09-12)에 따른 것으로, 백엔드 capability 는 그대로다.
 * - text: 텍스트 추론·이미지 이해·OCR 은 같은 VLM 하나가 처리한다(같은 모델을 세 번 고르게 하지 않는다)
 * - embed: 사용자가 고를 일이 없는 인프라 값이라 관리자 전역 화면에만
 * - 분석 계열(audio/music/video.analyze)은 실행 경로가 없어 숨긴다. music.generate 는 사용자 요청으로 그룹을 두되 "현재 미지원" 배지
 */
export interface CapabilityGroupDef {
  id: string;
  members: readonly string[];
  adminOnly?: boolean;
}
export const CAPABILITY_GROUPS: readonly CapabilityGroupDef[] = [
  { id: "text", members: ["text.reason", "vision.describe", "vision.ocr"] },
  { id: "code", members: ["text.code"] },
  { id: "image", members: ["image.generate", "image.edit"] },
  { id: "audio", members: ["audio.transcribe", "audio.speech"] },
  { id: "music", members: ["music.generate"] },
  { id: "video", members: ["video.generate"] },
  { id: "embed", members: ["text.embed"], adminOnly: true },
];
/** 그룹 안에 두는 미지원 capability — 배정은 저장되지만 실행 경로가 없다(배지로 표시). 나머지 미지원은 숨긴다 */
const GROUPED_UNSUPPORTED: ReadonlySet<string> = new Set(["music.generate"]);
/** 그룹 select 의 "개별 설정" 표시값 — 하위 배정이 서로 다를 때 */
export const MIXED_VALUE = "__mixed__";

export interface ResolvedGroup {
  id: string;
  members: string[];
}

/** 배정 가능 목록을 그룹으로 나눈다 — 어느 그룹에도 없는 capability 는 'other' 로 모아 잃어버리지 않는다 */
export function resolveCapabilityGroups(assignable: readonly string[], admin: boolean): { groups: ResolvedGroup[]; hiddenUnsupported: string[] } {
  const visible = (c: string) => !UNSUPPORTED_CAPABILITIES.has(c) || GROUPED_UNSUPPORTED.has(c);
  const placed = new Set<string>();
  const groups: ResolvedGroup[] = [];
  for (const def of CAPABILITY_GROUPS) {
    if (def.adminOnly && !admin) { def.members.forEach((m) => placed.add(m)); continue; }
    const members = def.members.filter((m) => assignable.includes(m) && visible(m));
    def.members.forEach((m) => placed.add(m));
    if (members.length > 0) groups.push({ id: def.id, members });
  }
  const other = assignable.filter((c) => !placed.has(c) && visible(c));
  if (other.length > 0) groups.push({ id: "other", members: other });
  const hiddenUnsupported = assignable.filter((c) => UNSUPPORTED_CAPABILITIES.has(c) && !GROUPED_UNSUPPORTED.has(c));
  return { groups, hiddenUnsupported };
}

/** 그룹 select 표시값 — 전원 같은 배정이면 그 값, 전원 미배정이면 DEFAULT, 섞이면 MIXED */
export function groupSelectValue(members: readonly string[], mapped: ReadonlyMap<string, string>): string {
  const values = members.map((m) => mapped.get(m) ?? DEFAULT_VALUE);
  return values.every((v) => v === values[0]) ? values[0] : MIXED_VALUE;
}

export function capabilityLabel(t: ReturnType<typeof useTranslations>, capability: string): string {
  return t(`capabilities.${capability.replace(/\./g, "_")}`);
}

interface ModelSelectProps {
  value: string;
  models: ModelEntry[];
  disabled: boolean;
  ariaLabel: string;
  t: ReturnType<typeof useTranslations>;
  mixed?: boolean;
  onChange: (fullId: string) => void;
}

function ModelSelect({ value, models, disabled, ariaLabel, t, mixed, onChange }: ModelSelectProps) {
  return (
    <select
      className="h-9 min-w-52 rounded-md border border-border-strong bg-surface px-2 text-sm text-fg outline-none focus:border-accent"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => { if (e.target.value !== MIXED_VALUE) onChange(e.target.value); }}
    >
      {mixed && <option value={MIXED_VALUE}>{t("mixedOption")}</option>}
      <option value={DEFAULT_VALUE}>{t("defaultOption")}</option>
      {/* 저장값이 목록 밖이면 값을 보존하는 옵션을 덧붙여 실제 배정을 표시(model-roles-section 의 "(목록에 없음)" 규칙) */}
      {value !== DEFAULT_VALUE && value !== MIXED_VALUE && !models.some((m) => m.modelId === value) && (
        <option value={value}>{value} {t("notInList")}</option>
      )}
      {models.map((m) => (
        <option key={m.modelId} value={m.modelId}>
          {m.name}{m.provider !== "local-llm" ? ` (${m.provider})` : ""}
        </option>
      ))}
    </select>
  );
}

export interface CapabilityGroupsEditorProps {
  t: ReturnType<typeof useTranslations>;
  admin?: boolean;
  capabilities: string[];
  mapped: ReadonlyMap<string, string>;
  savedParams: ReadonlyMap<string, Record<string, string> | undefined>;
  effectiveMap: ReadonlyMap<string, CapabilityEffective>;
  models: ModelEntry[];
  /** 진행 중인 저장(그룹 id 또는 capability) — 있으면 전체 입력 비활성 */
  busy: string | null;
  paramDrafts: Record<string, Record<string, string>>;
  /** 관리자 화면의 코드 기본값 표시(사용자 화면은 없음) */
  codeDefaults?: Record<string, string>;
  /** 배정 저장 — capabilities 전부에 같은 fullId(DEFAULT_VALUE 면 해제). 그룹 select 는 여러 개, 세부 행은 한 개 */
  onAssign: (capabilities: string[], fullId: string, busyKey: string) => void;
  onParamChange: (capability: string, key: string, value: string) => void;
  onParamApply: (capability: string) => void;
  labels: { assigned: string };
}

/** 그룹 단위 배정 편집기 — 사용자 설정·관리자 전역 공용 */
export function CapabilityGroupsEditor(props: CapabilityGroupsEditorProps) {
  const { t, admin = false, capabilities, mapped, savedParams, effectiveMap, models, busy, paramDrafts, codeDefaults, onAssign, onParamChange, onParamApply, labels } = props;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { groups, hiddenUnsupported } = resolveCapabilityGroups(capabilities, admin);
  const disabled = busy !== null;

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const value = groupSelectValue(g.members, mapped);
        const mixed = value === MIXED_VALUE;
        const assigned = g.members.some((m) => (mapped.get(m) ?? DEFAULT_VALUE) !== DEFAULT_VALUE);
        const expanded = open[g.id] ?? mixed; // 섞여 있으면 펼쳐서 어디가 다른지 바로 보이게
        const unsupported = g.members.every((m) => UNSUPPORTED_CAPABILITIES.has(m));
        const groupLabel = t(`groups.${g.id}`);
        return (
          <div key={g.id} className="rounded-lg border">
            <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap text-sm font-medium">{groupLabel}</span>
                  {assigned && <Badge tone="accent" className="shrink-0 whitespace-nowrap">{labels.assigned}</Badge>}
                  {mixed && <Badge tone="neutral" className="shrink-0 whitespace-nowrap">{t("mixedOption")}</Badge>}
                  {unsupported && <CapabilityUnsupportedBadge capability={g.members[0]} t={t} />}
                </div>
                <p className="text-xs text-muted">{t(`groupDesc.${g.id}`)}</p>
                {!expanded && g.members.length === 1 && <CapabilityEffectiveLine eff={effectiveMap.get(g.members[0])} t={t} />}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {busy === g.id && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
                <ModelSelect value={value} models={models} disabled={disabled} ariaLabel={groupLabel} t={t} mixed={mixed}
                  onChange={(fullId) => onAssign(g.members, fullId, g.id)} />
                {assigned && !disabled && (
                  <Button variant="ghost" size="sm" aria-label={t("resetLabel")} title={t("resetLabel")}
                    onClick={() => onAssign(g.members, DEFAULT_VALUE, g.id)}>
                    <RotateCcw className="h-4 w-4" aria-hidden />
                  </Button>
                )}
                <Button variant="ghost" size="sm" aria-expanded={expanded} aria-label={expanded ? t("advancedHide") : t("advancedShow")}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !expanded }))}>
                  {expanded ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                  <span className="text-xs">{expanded ? t("advancedHide") : t("advancedShow")}</span>
                </Button>
              </div>
            </div>
            {expanded && (
              <div className="space-y-2 border-t px-3 py-2">
                {g.members.map((capability) => {
                  const current = mapped.get(capability) ?? DEFAULT_VALUE;
                  const label = capabilityLabel(t, capability);
                  return (
                    <div key={capability} className="flex flex-col gap-2 rounded-md bg-surface-2/40 p-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="whitespace-nowrap text-sm">{label}</span>
                          <span className="font-mono text-xs text-muted">{capability}</span>
                          {current !== DEFAULT_VALUE && <Badge tone="accent" className="shrink-0 whitespace-nowrap">{labels.assigned}</Badge>}
                          <CapabilityUnsupportedBadge capability={capability} t={t} />
                        </div>
                        <CapabilityEffectiveLine eff={effectiveMap.get(capability)} t={t} />
                        {codeDefaults && <p className="text-xs text-muted">{t("codeDefault", { model: codeDefaults[capability] || "—" })}</p>}
                        <CapabilityParamsInputs
                          capability={capability}
                          draft={paramDrafts[capability] ?? {}}
                          saved={savedParams.get(capability)}
                          disabled={current === DEFAULT_VALUE}
                          busy={busy === capability}
                          onChange={(key, v) => onParamChange(capability, key, v)}
                          onApply={() => onParamApply(capability)}
                          t={t}
                        />
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {busy === capability && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
                        <ModelSelect value={current} models={models} disabled={disabled} ariaLabel={label} t={t}
                          onChange={(fullId) => onAssign([capability], fullId, capability)} />
                        {current !== DEFAULT_VALUE && !disabled && (
                          <Button variant="ghost" size="sm" aria-label={t("resetLabel")} title={t("resetLabel")}
                            onClick={() => onAssign([capability], DEFAULT_VALUE, capability)}>
                            <RotateCcw className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {hiddenUnsupported.length > 0 && (
        <p className="text-xs text-muted">{t("hiddenUnsupportedNote", { list: hiddenUnsupported.map((c) => capabilityLabel(t, c)).join(", ") })}</p>
      )}
    </div>
  );
}
