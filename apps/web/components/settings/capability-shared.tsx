"use client";

import { useTranslations } from "next-intl";
import { Save } from "lucide-react";
import { Button, Badge } from "@/components/ui/primitives";

/**
 * capability 배정 UI 공용 조각 — 사용자 설정(capability-models-section)과 관리자(admin/model-roles)가 같이 쓴다.
 * 그룹 편집기(capability-groups.tsx)와의 순환 import 를 피하려고 섹션 파일에서 분리(2026-09-12).
 */
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

/** 배정 미지정 select 값 — 전역/기본값으로 자동 해석됨 */
export const DEFAULT_VALUE = "";

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

