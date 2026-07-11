"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  X,
  Save,
  AlertTriangle,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { toBcp47 } from "@/i18n/config";

/* ── 타입 (백엔드 /api/external-keys 응답) ──────────────── */
type SdkType = "anthropic" | "openai-compatible";

interface UserKey {
  display_name: string;
  key_prefix: string;
  base_url: string | null;
  last_validation_ok: boolean | null;
  last_used_at: string | null;
  created_at: string;
}

interface ProviderEntry {
  provider_id: string;
  display_name: string;
  sdk_type: SdkType;
  default_base_url: string | null;
  help_text?: string;
  user_key: UserKey | null;
}

/** SdkType → 번역 키 (렌더 시 t() 로 해석) */
const SDK_LABEL_KEY: Record<SdkType, string> = {
  anthropic: "sdkType.anthropic",
  "openai-compatible": "sdkType.openaiCompatible",
};

function formatDate(iso: string | null | undefined, locale: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * 외부 LLM 공급자(BYOK) 키 관리 — 구 /api-keys 페이지 본문을 설정 '모델' 탭으로 흡수한 것
 * (2026-07-11 사이드바 통폐합). 구 라우트 /api-keys 는 /settings?tab=model 로 redirect.
 */
export function ProviderKeysSection() {
  const t = useTranslations("apiKeys");
  const locale = toBcp47(useLocale());
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.get<ApiSuccess<{ providers: ProviderEntry[] }>>(
        "/api/external-keys",
      );
      setProviders(res?.data?.providers ?? []);
    } catch (e) {
      // TODO: API 연동 — 비로그인/오류 시 목업 카탈로그 노출
      setError(e instanceof Error ? e.message : t("loadError"));
      setProviders([
        {
          provider_id: "anthropic",
          display_name: "Anthropic",
          sdk_type: "anthropic",
          default_base_url: "https://api.anthropic.com",
          user_key: {
            display_name: t("mock.productionName"),
            key_prefix: "sk-ant-",
            base_url: null,
            last_validation_ok: true,
            last_used_at: "2026-06-18T08:21:00Z",
            created_at: "2026-05-30T02:10:00Z",
          },
        },
        {
          provider_id: "openrouter",
          display_name: "OpenRouter",
          sdk_type: "openai-compatible",
          default_base_url: "https://openrouter.ai/api/v1",
          user_key: null,
        },
      ]);
    } finally {
      setLoading(false);
    }
    // locale 변경(t) 시 목업 폴백 라벨 재생성
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleDelete(providerId: string, displayName: string) {
    if (!window.confirm(t("deleteConfirm", { name: displayName }))) return;
    try {
      await ApiClient.del(`/api/external-keys/${providerId}`);
      await load();
    } catch (e) {
      window.alert(
        t("deleteFailed", {
          error: e instanceof Error ? e.message : t("serverError"),
        }),
      );
    }
  }

  const registered = providers.filter((p) => p.user_key);

  return (
    <div className="space-y-6">
      {showForm && (
        <AddKeyForm
          providers={providers}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false);
            await load();
          }}
        />
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>{t("title")}</CardTitle>
            <p className="mt-1 text-xs text-muted">{t("description")}</p>
          </div>
          <div className="flex items-center gap-2">
            {error && (
              <span className="inline-flex items-center gap-1 text-xs text-warn">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("mockDataShown")}
              </span>
            )}
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showForm ? t("close") : t("addKey")}
            </Button>
          </div>
        </CardHeader>
            <CardContent className="px-0 py-0">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("loading")}
                </div>
              ) : registered.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <KeyRound className="h-8 w-8 text-faint" />
                  <p className="text-sm font-medium text-fg">
                    {t("emptyTitle")}
                  </p>
                  <p className="text-xs text-muted">{t("emptyDesc")}</p>
                </div>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>{t("col.provider")}</Th>
                      <Th>{t("col.name")}</Th>
                      <Th>{t("col.key")}</Th>
                      <Th>{t("col.createdAt")}</Th>
                      <Th>{t("col.status")}</Th>
                      <Th className="text-right">{t("col.actions")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {registered.map((p) => {
                      const k = p.user_key!;
                      const ok = k.last_validation_ok;
                      return (
                        <tr key={p.provider_id}>
                          <Td className="text-fg">
                            <div className="font-medium">{p.display_name}</div>
                            <div className="text-xs text-faint">
                              {t(SDK_LABEL_KEY[p.sdk_type])}
                            </div>
                          </Td>
                          <Td>{k.display_name}</Td>
                          <Td className="font-mono text-xs">
                            {k.key_prefix}
                            {"•".repeat(12)}
                          </Td>
                          <Td>{formatDate(k.created_at, locale)}</Td>
                          <Td>
                            {ok === false ? (
                              <Badge tone="danger">
                                {t("status.validationFailed")}
                              </Badge>
                            ) : ok ? (
                              <Badge tone="success">{t("status.active")}</Badge>
                            ) : (
                              <Badge tone="neutral">
                                {t("status.unverified")}
                              </Badge>
                            )}
                          </Td>
                          <Td className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t("deleteAria")}
                              onClick={() =>
                                handleDelete(p.provider_id, p.display_name)
                              }
                            >
                              <Trash2 className="h-4 w-4 text-danger" />
                            </Button>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardContent>
      </Card>
    </div>
  );
}

/* ── 인라인 키 추가 폼 ──────────────────────────────────── */
function AddKeyForm({
  providers,
  onClose,
  onSaved,
}: {
  providers: ProviderEntry[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("apiKeys");
  const [providerId, setProviderId] = useState(
    providers[0]?.provider_id ?? "anthropic",
  );
  const [displayName, setDisplayName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const selected = providers.find((p) => p.provider_id === providerId);

  async function handleSubmit() {
    if (!displayName.trim() || apiKey.trim().length < 8) {
      setFormError(t("validationError"));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await ApiClient.post<
        { success: boolean; data?: { validated?: boolean; validation_error?: string | null } }
      >(`/api/external-keys/${providerId}`, {
        sdk_type: selected?.sdk_type ?? "openai-compatible",
        display_name: displayName.trim(),
        api_key: apiKey.trim(),
        base_url: baseUrl.trim() || null,
      });
      // 등록 직후 즉시 검증 결과 — 실패면 저장은 됐지만 endpoint 미도달.
      // 폼을 유지해 주소/키를 바로 고칠 수 있게 한다 (재저장 = upsert).
      if (res?.data?.validated === false) {
        setFormError(
          t("validationWarning", {
            error: res.data.validation_error ?? t("serverError"),
          }),
        );
        return;
      }
      await onSaved();
    } catch (err) {
      setFormError(
        t("saveFailed", {
          error: err instanceof Error ? err.message : t("serverError"),
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{t("addKey")}</CardTitle>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("close")}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-2">
                {t("col.provider")}
              </span>
              <select
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
              >
                {providers.map((p) => (
                  <option key={p.provider_id} value={p.provider_id}>
                    {p.display_name} ({t(SDK_LABEL_KEY[p.sdk_type])})
                  </option>
                ))}
              </select>
              {selected?.help_text && (
                <span className="mt-1 block text-xs leading-relaxed text-muted">
                  {selected.help_text}
                </span>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-fg-2">
                {t("col.name")}
              </span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t("namePlaceholder")}
                className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-accent"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-2">
              {t("apiKeyLabel")}
            </span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm text-fg outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-fg-2">
              {t("baseUrlLabel")}
            </span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected?.default_base_url ?? "https://..."}
              className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 font-mono text-sm text-fg outline-none focus:border-accent"
            />
          </label>

          {formError && <p className="text-xs text-danger">{formError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
