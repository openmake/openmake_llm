"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import {
  KeyRound,
  Plus,
  Trash2,
  Loader2,
  X,
  Save,
  AlertTriangle,
  ShieldCheck,
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
  auth_method?: "api_key" | "oauth";
  oauth_account_id?: string | null;
  last_validation_ok: boolean | null;
  last_used_at: string | null;
  created_at: string;
}

interface ProviderEntry {
  provider_id: string;
  display_name: string;
  sdk_type: SdkType;
  auth_methods?: Array<"api_key" | "oauth">;
  default_base_url: string | null;
  help_text?: string;
  user_key: UserKey | null;
}

/** OAuth 디바이스 플로우 시작 응답 (backend external-oauth.routes) */
interface OAuthStartData {
  device_auth_id: string;
  user_code: string;
  verification_url: string;
  interval_sec: number;
}

/** 사용량 요약 응답 (backend GET /api/external-keys/usage/summary) */
interface UsageSummaryData {
  days: number;
  totals_by_provider: Array<{
    provider_id: string;
    call_count: number;
    input_tokens: number;
    output_tokens: number;
  }>;
}

/** provider_id → 최근 사용량 (표시용 집계) */
interface ProviderUsage {
  calls: number;
  tokens: number;
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
  const pt = useTranslations("providerKeys");
  const locale = toBcp47(useLocale());
  const queryClient = useQueryClient();
  const [providers, setProviders] = useState<ProviderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [usage, setUsage] = useState<Record<string, ProviderUsage>>({});
  const [usageDays, setUsageDays] = useState(30);
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [validateMsg, setValidateMsg] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ApiClient.get<ApiSuccess<{ providers: ProviderEntry[] }>>(
        "/api/external-keys",
      );
      setProviders(res?.data?.providers ?? []);
    } catch (e) {
      // 비로그인/오류 — 목업 주입 금지(가짜 '활성' 키가 실제 등록으로 오인됨). 빈 목록 + 에러 표시.
      setError(e instanceof Error ? e.message : t("loadError"));
      setProviders([]);
    } finally {
      setLoading(false);
    }
    // 사용량 요약은 부가 정보 — 실패해도 키 목록 표시를 막지 않는다(fail-soft).
    try {
      const u = await ApiClient.get<ApiSuccess<UsageSummaryData>>(
        "/api/external-keys/usage/summary",
      );
      const map: Record<string, ProviderUsage> = {};
      for (const row of u?.data?.totals_by_provider ?? []) {
        map[row.provider_id] = {
          calls: row.call_count,
          tokens: row.input_tokens + row.output_tokens,
        };
      }
      setUsage(map);
      if (u?.data?.days) setUsageDays(u.data.days);
    } catch {
      setUsage({});
    }
    // locale 변경(t) 시 목업 폴백 라벨 재생성
  }, [t]);

  const handleValidate = useCallback(
    async (providerId: string) => {
      setValidating((v) => ({ ...v, [providerId]: true }));
      setValidateMsg((m) => {
        const next = { ...m };
        delete next[providerId];
        return next;
      });
      try {
        await ApiClient.post(`/api/external-keys/${providerId}/validate`, {});
        setValidateMsg((m) => ({
          ...m,
          [providerId]: { ok: true, text: pt("validateOk") },
        }));
      } catch (e) {
        setValidateMsg((m) => ({
          ...m,
          [providerId]: {
            ok: false,
            text: pt("validateFailed", {
              error: e instanceof Error ? e.message : pt("error"),
            }),
          },
        }));
      } finally {
        setValidating((v) => ({ ...v, [providerId]: false }));
        // 검증 결과가 last_validation_ok 에 기록됨 — 상태 뱃지 갱신 위해 재조회.
        await load();
      }
    },
    [pt, load],
  );

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleDelete(providerId: string, displayName: string) {
    if (!window.confirm(t("deleteConfirm", { name: displayName }))) return;
    try {
      await ApiClient.del(`/api/external-keys/${providerId}`);
      await load();
      // 키 삭제로 해당 provider 모델이 목록에서 빠짐 — 기본 모델 picker/컴포저 즉시 반영
      void queryClient.invalidateQueries({ queryKey: ["models"] });
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
            // 키 등록 직후 새 provider 모델이 기본 모델 picker 에 바로 나타나도록
            void queryClient.invalidateQueries({ queryKey: ["models"] });
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
                {t("loadError")}
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
                    {/* 헤더 글자가 세로로 꺾이던 것 — 줄바꿈 대신 가로 스크롤 */}
                    <tr className="whitespace-nowrap">
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
                      const u = usage[p.provider_id];
                      const vMsg = validateMsg[p.provider_id];
                      return (
                        <tr key={p.provider_id}>
                          <Td className="text-fg">
                            <div className="font-medium">{p.display_name}</div>
                            <div className="text-xs text-faint">
                              {t(SDK_LABEL_KEY[p.sdk_type])}
                            </div>
                            {u && u.calls > 0 && (
                              <div className="mt-0.5 text-xs text-muted">
                                {pt("usageSummary", {
                                  days: usageDays,
                                  calls: u.calls.toLocaleString(locale),
                                  tokens: u.tokens.toLocaleString(locale),
                                })}
                              </div>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap">{k.display_name}</Td>
                          <Td className="whitespace-nowrap font-mono text-xs">
                            {k.key_prefix}
                            {"•".repeat(12)}
                          </Td>
                          {/* 날짜·상태·작업은 폭이 모자라도 글자를 꺾지 않는다 — "2026. 05. 08." 이 3줄로
                              쪼개지던 것(1440px 실측). 모자라면 Table 의 가로 스크롤에 맡긴다 */}
                          <Td className="whitespace-nowrap">{formatDate(k.created_at, locale)}</Td>
                          <Td className="whitespace-nowrap">
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
                          <Td className="whitespace-nowrap text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={validating[p.provider_id]}
                                onClick={() => void handleValidate(p.provider_id)}
                              >
                                {validating[p.provider_id] ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-4 w-4" />
                                )}
                                {pt("validate")}
                              </Button>
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
                            </div>
                            {vMsg && (
                              <p
                                className={`mt-1 text-xs ${
                                  vMsg.ok ? "text-success" : "text-danger"
                                }`}
                              >
                                {vMsg.text}
                              </p>
                            )}
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
  const isOAuthOnly =
    !!selected?.auth_methods &&
    selected.auth_methods.includes("oauth") &&
    !selected.auth_methods.includes("api_key");

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
          {isOAuthOnly ? (
            <OAuthConnect providerId={providerId} onConnected={onSaved} />
          ) : (
            <>
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
            </>
          )}

          {formError && <p className="text-xs text-danger">{formError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            {!isOAuthOnly && (
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {t("save")}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* ── OAuth 디바이스 플로우 연결 (ChatGPT) ─────────────────── */
function OAuthConnect({
  providerId,
  onConnected,
}: {
  providerId: string;
  onConnected: () => void | Promise<void>;
}) {
  const t = useTranslations("apiKeys");
  const [start, setStart] = useState<OAuthStartData | null>(null);
  const [starting, setStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  async function handleStart() {
    setStarting(true);
    setOauthError(null);
    try {
      const res = await ApiClient.post<ApiSuccess<OAuthStartData>>(
        `/api/external-keys/${providerId}/oauth/start`,
        {},
      );
      if (!res?.data?.user_code) throw new Error(t("serverError"));
      setStart(res.data);
    } catch (e) {
      setOauthError(
        t("oauthFailed", {
          error: e instanceof Error ? e.message : t("serverError"),
        }),
      );
    } finally {
      setStarting(false);
    }
  }

  // 승인 폴링 — start 후 interval_sec 간격으로 poll, complete 시 종료
  useEffect(() => {
    if (!start || connected) return;
    let cancelled = false;
    const intervalMs = Math.max(start.interval_sec, 1) * 1000;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await ApiClient.post<
            ApiSuccess<{ status: "pending" | "complete" }>
          >(`/api/external-keys/${providerId}/oauth/poll`, {
            device_auth_id: start.device_auth_id,
            user_code: start.user_code,
          });
          if (cancelled) return;
          if (res?.data?.status === "complete") {
            setConnected(true);
            clearInterval(timer);
            await onConnected();
          }
        } catch (e) {
          if (cancelled) return;
          clearInterval(timer);
          setOauthError(
            t("oauthFailed", {
              error: e instanceof Error ? e.message : t("serverError"),
            }),
          );
          setStart(null);
        }
      })();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [start, connected, providerId, onConnected, t]);

  if (connected) {
    return (
      <p className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg">
        ✅ {t("oauthConnected")}
      </p>
    );
  }

  if (start) {
    return (
      <div className="space-y-3 rounded-md border border-border bg-surface-2 p-4">
        <p className="text-xs leading-relaxed text-muted">
          {t("oauthInstruction")}
        </p>
        <div>
          <span className="mb-1 block text-xs font-medium text-fg-2">
            {t("oauthCodeLabel")}
          </span>
          <code className="block select-all rounded-md border border-border-strong bg-surface px-3 py-2 text-center font-mono text-lg tracking-widest text-fg">
            {start.user_code}
          </code>
        </div>
        <a
          href={start.verification_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          {t("oauthOpenPage")} ↗
        </a>
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t("oauthWaiting")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{t("oauthHint")}</p>
      <Button type="button" onClick={() => void handleStart()} disabled={starting}>
        {starting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <KeyRound className="h-4 w-4" />
        )}
        {t("oauthLogin")}
      </Button>
      {oauthError && <p className="text-xs text-danger">{oauthError}</p>}
    </div>
  );
}
