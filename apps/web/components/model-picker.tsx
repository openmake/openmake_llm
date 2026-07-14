"use client";

/**
 * 기본모델 2단계 선택 (provider → model, 대형 목록 검색 필터)
 *
 * 설정 페이지와 채팅 컴포저(모델 칩 팝오버)가 공유하는 컴포넌트.
 * 별도 provider state 없이 value(SoT)에서 유도해 두 select 가 항상 저장값과 일관.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

/** 2단계 검색 입력을 노출하는 모델 수 임계값 (OpenRouter 340개 등 대형 목록 대응) */
const MODEL_SEARCH_THRESHOLD = 20;
/** 1단계 "자동 (서버 기본값)" 센티널 — 저장값 'default' 와 매핑 */
const PROVIDER_AUTO = "__auto__";

export type PickerModel = {
  name: string;
  modelId: string;
  provider: string;
  isFree?: boolean;
};

/** provider id → 1단계 표시 라벨 (신규 provider 는 일반 처리 `🌐 {id}`) */
const EXTERNAL_PROVIDER_LABELS: Record<string, string> = {
  openrouter: "🌐 OpenRouter",
  "ollama-local": "🌐 Ollama (Local)",
  "ollama-cloud": "🌐 Ollama Cloud",
  nvidia: "🌐 NVIDIA NIM",
};

export function ModelPicker({
  models,
  value,
  onChange,
}: {
  models: PickerModel[];
  /** 선택된 모델 fullId 또는 'default' (자동) */
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useTranslations("settings");
  const [filter, setFilter] = useState("");

  const providerLabel = (provider: string) =>
    provider === "local-llm"
      ? t("modelGroup.local")
      : (EXTERNAL_PROVIDER_LABELS[provider] ?? `🌐 ${provider}`);

  // provider 목록 — local-llm 우선, 외부는 응답 등장 순서 유지
  const providers = useMemo(() => {
    const seen: string[] = [];
    for (const m of models) if (!seen.includes(m.provider)) seen.push(m.provider);
    return seen.sort((a, b) => (a === "local-llm" ? -1 : b === "local-llm" ? 1 : 0));
  }, [models]);

  const currentProvider = useMemo(() => {
    if (!value || value === "default") return PROVIDER_AUTO;
    return models.find((m) => m.modelId === value)?.provider ?? PROVIDER_AUTO;
  }, [models, value]);

  // 현재 provider 의 모델 목록 (무료 우선 안정 정렬)
  const providerModels = useMemo(() => {
    if (currentProvider === PROVIDER_AUTO) return [];
    return models
      .filter((m) => m.provider === currentProvider)
      .slice()
      .sort((a, b) => (b.isFree ? 1 : 0) - (a.isFree ? 1 : 0));
  }, [models, currentProvider]);

  const searchable = providerModels.length > MODEL_SEARCH_THRESHOLD;
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? providerModels.filter(
        (m) => m.name.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q),
      )
    : providerModels;
  // 검색으로 현재 선택이 걸러져도 select 표시값이 어긋나지 않게 상단 고정
  const selectedEntry = providerModels.find((m) => m.modelId === value);
  const visible =
    selectedEntry && !filtered.some((m) => m.modelId === value)
      ? [selectedEntry, ...filtered]
      : filtered;

  const changeProvider = (p: string) => {
    setFilter("");
    if (p === PROVIDER_AUTO) {
      onChange("default");
      return;
    }
    // 해당 provider 의 첫 모델(무료 우선)로 즉시 전환 — value 가 SoT 라 2단계도 동기화됨
    const first = models
      .filter((m) => m.provider === p)
      .slice()
      .sort((a, b) => (b.isFree ? 1 : 0) - (a.isFree ? 1 : 0))[0];
    if (first) onChange(first.modelId);
  };

  const freeSuffix = t("freeSuffix");
  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={currentProvider}
        onChange={(e) => changeProvider(e.target.value)}
        aria-label={t("modelPicker.providerAria")}
        className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
      >
        <option value={PROVIDER_AUTO}>{t("modelGroup.auto")}</option>
        {providers.map((p) => (
          <option key={p} value={p}>
            {providerLabel(p)}
          </option>
        ))}
      </select>
      {currentProvider !== PROVIDER_AUTO && (
        <>
          {searchable && (
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("modelPicker.searchPlaceholder")}
              aria-label={t("modelPicker.searchPlaceholder")}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition placeholder:text-muted focus:border-accent"
            />
          )}
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={t("modelPicker.modelAria")}
            className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
          >
            {visible.length === 0 ? (
              <option value={value} disabled>
                {t("modelPicker.noMatch")}
              </option>
            ) : (
              visible.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.name + (m.isFree ? freeSuffix : "")}
                </option>
              ))
            )}
          </select>
          {searchable && (
            <p className="text-xs text-muted">
              {t("modelPicker.count", { shown: visible.length, total: providerModels.length })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
