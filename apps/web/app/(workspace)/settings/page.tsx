"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Settings,
  Bot,
  Brain,
  Palette,
  Bell,
  Server,
  ShieldCheck,
  Save,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  PageHeader,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { useQuery } from "@tanstack/react-query";
import { ApiClient, ApiError } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { fetchModels } from "@/lib/models-api";
import { cn } from "@/lib/utils";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale, toBcp47 } from "@/i18n/config";
import { ModelPicker } from "@/components/model-picker";
import { MemorySection } from "@/components/settings/memory-section";
import { ConnectorsSection } from "@/components/settings/connectors-section";
import { GithubConnectSection } from "@/components/settings/github-connect-section";
import { ProviderKeysSection } from "@/components/settings/provider-keys-section";
import { ModelRolesSection } from "@/components/settings/model-roles-section";

/* ── 탭 정의 ────────────────────────────────────────────── */
type TabId = "general" | "model" | "interface" | "notifications" | "memory" | "connectors" | "privacy" | "security";

const TABS: { id: TabId; labelKey: string; icon: LucideIcon }[] = [
  { id: "general", labelKey: "tabs.general", icon: Settings },
  { id: "model", labelKey: "tabs.model", icon: Bot },
  { id: "interface", labelKey: "tabs.interface", icon: Palette },
  { id: "notifications", labelKey: "tabs.notifications", icon: Bell },
  { id: "memory", labelKey: "tabs.memory", icon: Brain },
  { id: "connectors", labelKey: "tabs.connectors", icon: Server },
  { id: "privacy", labelKey: "tabs.privacy", icon: ShieldCheck },
  { id: "security", labelKey: "tabs.security", icon: ShieldCheck },
];


const RESPONSE_STYLES = [
  { value: "concise", labelKey: "responseStyles.concise" },
  { value: "default", labelKey: "responseStyles.default" },
  { value: "verbose", labelKey: "responseStyles.verbose" },
] as const;

const THEMES = [
  { value: "system", labelKey: "themes.system" },
  { value: "light", labelKey: "themes.light" },
  { value: "dark", labelKey: "themes.dark" },
];

/** NEXT_LOCALE 쿠키 값 (미설정/미지원 값 = "" → 자동 감지). */
function readLocaleCookie(): string {
  const v = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
    ?.split("=")[1];
  return isLocale(v) ? v : "";
}
// 쿠키 변경은 changeLanguage → router.refresh() 재렌더로만 발생 — 별도 구독 불필요.
const emptySubscribe = () => () => {};

/** UI 표시 언어. 언어명은 각 언어의 자기 표기(native name)라 번역하지 않고, "자동 감지"만 t 로 치환. */
const LANGUAGES = [
  { value: "", label: "" }, // label 은 렌더 시 t("languageAuto") 로 채움
  { value: "ko", label: "한국어" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "zh", label: "中文(简体)" },
];

const CUSTOM_INSTRUCTIONS_MAX = 4000;

/* ── 공통 폼 프리미티브 ─────────────────────────────────── */
function FieldRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h4 className="text-sm font-medium text-fg">{title}</h4>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <div className="shrink-0 sm:max-w-xs sm:flex-1">{children}</div>
    </div>
  );
}

type SelectOption = { value: string; label: string };
type SelectGroup = { label: string; options: SelectOption[] };

function Select({
  value,
  onChange,
  options,
  groups,
}: {
  value: string;
  onChange: (v: string) => void;
  options?: SelectOption[];
  /** 제공 시 <optgroup> 으로 분류 렌더 (provider 별 구분 등). options 보다 우선. */
  groups?: SelectGroup[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
    >
      {groups
        ? groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))
        : (options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
    </select>
  );
}

function Segment<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex w-full rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-xs font-medium transition",
            value === o.value
              ? "bg-surface text-fg shadow-1"
              : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── 페이지 ─────────────────────────────────────────────── */
export default function SettingsPage() {
  const tSettings = useTranslations("settings");
  const bcp47 = toBcp47(useLocale());
  // /memory·/api-keys 흡수(2026-07-11): 구 라우트 redirect 가 ?tab= 으로 진입한다.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState<TabId>(
    TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "general",
  );
  // 뒤로가기/앞으로가기로 ?tab= 이 바뀌면 상태 동기화 (탭 클릭은 selectTab 이 URL 에 반영)
  useEffect(() => {
    const p = searchParams.get("tab");
    if (p && TABS.some((t) => t.id === p)) setTab(p as TabId);
  }, [searchParams]);

  // 일반 / 모델
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  // 응답 스타일 — composer 사이클 버튼과 동일한 store.style 을 단일 소스로 사용(영속화됨).
  const responseStyle = useAppStore((s) => s.style);
  const setResponseStyle = useAppStore((s) => s.setStyle);
  const setPrivacyPrefs = useAppStore((s) => s.setPrivacyPrefs);
  // 게스트(비로그인)는 기본 모델만 사용 가능 — 외부 provider(Ollama/OpenRouter)는 가입 이용자 전용.
  const isGuest = !useAppStore((s) => s.auth.currentUser);
  const { data: modelsData } = useQuery({
    queryKey: ["models"],
    queryFn: () => fetchModels({ usableOnly: true }),
    staleTime: 60_000,
  });
  // 기본 모델은 2단계 선택(provider → model)으로 노출 — components/model-picker.tsx 공용
  const allModels = modelsData?.models ?? [];
  const externalModels = allModels.filter((m) => m.provider !== "local-llm");
  // UI 표시 언어 — NEXT_LOCALE 쿠키가 SoT (i18n/request.ts 가 서버 렌더 시 읽음).
  // 로컬 state 중복 없이 쿠키를 직접 구독: 서버 스냅샷 "" → hydration 후 클라 값으로 갱신.
  const language = useSyncExternalStore(
    emptySubscribe,
    readLocaleCookie,
    () => "",
  );
  const [customInstructions, setCustomInstructions] = useState("");
  const router = useRouter();

  const changeLanguage = (v: string) => {
    if (isLocale(v)) {
      document.cookie = `${LOCALE_COOKIE}=${v}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    } else {
      // "자동 감지" — 쿠키 제거 → Accept-Language 협상으로 복귀
      document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
    }
    router.refresh(); // 재렌더 → useSyncExternalStore 가 쿠키를 다시 읽음
  };

  // 인터페이스
  const [theme, setTheme] = useState("system");

  // 알림
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [pushAlerts, setPushAlerts] = useState(false);
  const [pushSupported, setPushSupported] = useState<boolean | null>(null);
  const [pushSwReady, setPushSwReady] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  // 개인정보
  const [saveHistory, setSaveHistory] = useState(true);
  const [memoryLearning, setMemoryLearning] = useState(true);

  // 보안 — 비밀번호 변경
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  // 동의(consent) 상태 + 철회/재동의
  const [consents, setConsents] = useState<{ type: string; granted: boolean; version: string; locale?: string }[]>([]);
  const [consentBusy, setConsentBusy] = useState<string | null>(null);

  // 푸시 지원 여부 및 현재 구독 상태 초기화
  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported =
      "serviceWorker" in navigator && "PushManager" in window;
    setPushSupported(supported);
    if (!supported) return;

    navigator.serviceWorker.ready
      .then((reg) => {
        setPushSwReady(true);
        return reg.pushManager.getSubscription();
      })
      .then((sub) => {
        if (sub) setPushAlerts(true);
      })
      .catch(() => {
        // SW 등록 안 됨
      });
  }, []);

  function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const arr = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) {
      arr[i] = rawData.charCodeAt(i);
    }
    return arr.buffer;
  }

  async function handlePushToggle(on: boolean) {
    if (typeof window === "undefined") return;
    setPushLoading(true);
    try {
      if (on) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPushLoading(false);
          return;
        }
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          const vapidRes = await ApiClient.get<{ data: { publicKey: string } }>(
            "/api/push/vapid-key",
          );
          const key = vapidRes?.data?.publicKey;
          if (!key) throw new Error("VAPID key 없음");
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key),
          });
        }
        const json = sub.toJSON();
        await ApiClient.post("/api/push/subscribe", {
          endpoint: sub.endpoint,
          keys: json.keys,
        });
        setPushAlerts(true);
      } else {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await ApiClient.post("/api/push/unsubscribe", { endpoint: sub.endpoint });
        }
        setPushAlerts(false);
      }
    } catch (err) {
      console.error("push toggle error", err);
    } finally {
      setPushLoading(false);
    }
  }

  // custom-instructions + preferences 서버 로드 (language 는 NEXT_LOCALE 쿠키로 별도 처리)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await ApiClient.get<
          ApiSuccess<{ customInstructions: string | null }>
        >("/api/users/me/custom-instructions");
        const ci = res?.data?.customInstructions;
        if (alive && typeof ci === "string") setCustomInstructions(ci);
      } catch {
        // 비로그인/네트워크 실패 — 무시하고 빈 값 유지
      }
      try {
        const pres = await ApiClient.get<ApiSuccess<{ preferences: Record<string, unknown> }>>(
          "/api/users/me/preferences",
        );
        const p = pres?.data?.preferences ?? {};
        if (alive) {
          if (typeof p.defaultModel === "string") setSelectedModel(p.defaultModel);
          if (p.responseStyle === "concise" || p.responseStyle === "default" || p.responseStyle === "verbose")
            setResponseStyle(p.responseStyle);
          if (typeof p.theme === "string") setTheme(p.theme);
          if (typeof p.emailAlerts === "boolean") setEmailAlerts(p.emailAlerts);
          const sh = typeof p.saveHistory === "boolean" ? p.saveHistory : true;
          const ml = typeof p.memoryLearning === "boolean" ? p.memoryLearning : true;
          setSaveHistory(sh);
          setMemoryLearning(ml);
          setPrivacyPrefs({ saveHistory: sh, memoryLearning: ml });
        }
      } catch {
        // 미설정/실패 — 기본값 유지
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [setSelectedModel, setResponseStyle, setPrivacyPrefs]);

  // 동의(consent) 상태 로드
  useEffect(() => {
    let alive = true;
    ApiClient.get<ApiSuccess<{ consents: { type: string; granted: boolean; version: string; locale?: string }[] }>>(
      "/api/users/me/consent",
    )
      .then((res) => {
        if (alive) setConsents(res?.data?.consents ?? []);
      })
      .catch(() => {
        /* 미로그인/실패 */
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const trimmed = customInstructions.trim();
      await ApiClient.put("/api/users/me/custom-instructions", {
        customInstructions: trimmed.length > 0 ? trimmed : null,
      });
      // defaultModel/responseStyle/theme/알림/개인정보 영속화 (language 는 NEXT_LOCALE 쿠키로 완료).
      await ApiClient.put("/api/users/me/preferences", {
        defaultModel: selectedModel,
        responseStyle,
        theme,
        emailAlerts,
        saveHistory,
        memoryLearning,
      });
      // 개인정보 설정은 채팅 WS 메시지로 전송돼 즉시 적용되도록 store 에 반영.
      setPrivacyPrefs({ saveHistory, memoryLearning });
      setSavedAt(new Date().toLocaleTimeString(bcp47));
    } catch {
      setSavedAt(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      // GET /api/users/me/export 는 Content-Disposition attachment(JSON) — blob 다운로드.
      const res = await fetch("/api/users/me/export", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openmake_export_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* 실패 — 조용히 무시(재시도 가능) */
    } finally {
      setExporting(false);
    }
  }

  type ConsentRow = { type: string; granted: boolean; version: string; locale?: string };

  async function reloadConsent() {
    try {
      const res = await ApiClient.get<ApiSuccess<{ consents: ConsentRow[] }>>("/api/users/me/consent");
      setConsents(res?.data?.consents ?? []);
    } catch {
      /* 미로그인/실패 */
    }
  }

  async function handleWithdraw(c: ConsentRow) {
    if (consentBusy) return;
    if (!window.confirm(tSettings("consent.withdrawConfirm"))) return;
    setConsentBusy(c.type);
    try {
      await ApiClient.post("/api/users/me/consent/withdraw", { type: c.type });
      await reloadConsent();
    } catch {
      /* 실패 — 재시도 가능 */
    } finally {
      setConsentBusy(null);
    }
  }

  async function handleGrant(c: ConsentRow) {
    if (consentBusy) return;
    setConsentBusy(c.type);
    try {
      await ApiClient.post("/api/users/me/consent", { type: c.type, version: c.version, locale: c.locale ?? "ko" });
      await reloadConsent();
    } catch {
      /* 실패 — 재시도 가능 */
    } finally {
      setConsentBusy(null);
    }
  }

  async function handlePasswordChange() {
    if (newPassword !== confirmPassword) {
      setPwMessage({ text: tSettings("password.mismatch"), ok: false });
      return;
    }
    if (newPassword.length < 8) {
      setPwMessage({ text: tSettings("password.tooShort"), ok: false });
      return;
    }
    setPwSaving(true);
    setPwMessage(null);
    try {
      await ApiClient.put("/api/auth/password", { currentPassword, newPassword });
      setPwMessage({ text: tSettings("password.changed"), ok: true });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : tSettings("password.changeFailed");
      setPwMessage({ text: msg, ok: false });
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={tSettings("pageTitle")}
        description={tSettings("pageDescription")}
        actions={
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="text-xs text-muted">{tSettings("savedAt", { time: savedAt })}</span>
            )}
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {tSettings("saveButton")}
            </Button>
          </div>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 lg:flex-row">
          {/* 좌측 세로 탭 */}
          <nav className="flex shrink-0 gap-1 overflow-x-auto lg:w-48 lg:flex-col">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTab(t.id);
                    // URL 동기화 — 새로고침/뒤로가기가 딥링크 탭으로 되돌리지 않게
                    router.replace(`/settings?tab=${t.id}`, { scroll: false });
                  }}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tSettings(t.labelKey)}
                </button>
              );
            })}
          </nav>

          {/* 우측 폼 */}
          <div className="min-w-0 flex-1 space-y-6">
            {tab === "general" && (
              <Card>
                <CardHeader>
                  <CardTitle>{tSettings("tabs.general")}</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title={tSettings("language.title")}
                    description={tSettings("language.description")}
                  >
                    <Select
                      value={language}
                      onChange={changeLanguage}
                      options={LANGUAGES.map((o) =>
                        o.value === "" ? { ...o, label: tSettings("languageAuto") } : o,
                      )}
                    />
                  </FieldRow>
                  <FieldRow
                    title={tSettings("saveHistory.title")}
                    description={tSettings("saveHistory.descriptionGeneral")}
                  >
                    <Toggle checked={saveHistory} onChange={setSaveHistory} />
                  </FieldRow>
                </CardContent>
              </Card>
            )}

            {tab === "model" && (
              <>
              <Card>
                <CardHeader>
                  <CardTitle>{tSettings("tabs.model")}</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title={tSettings("defaultModel.title")}
                    description={tSettings("defaultModel.description")}
                  >
                    {isGuest ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex h-9 items-center rounded-md border border-border bg-surface-2 px-3 text-sm text-muted">
                          {tSettings("modelGroup.auto")}
                          {modelsData?.defaultModel ? ` · ${modelsData.defaultModel}` : ""}
                        </div>
                        <p className="rounded-md border border-border bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-muted">
                          {tSettings("guestModelNotice")}
                        </p>
                      </div>
                    ) : allModels.length ? (
                      <div className="flex flex-col gap-1.5">
                        <ModelPicker
                          models={allModels}
                          value={selectedModel}
                          onChange={setSelectedModel}
                        />
                        {/* 키 등록 섹션이 같은 탭 하단(ProviderKeysSection)으로 흡수됨 — 링크 대신 안내만 */}
                        {externalModels.length === 0 && (
                          <p className="text-xs text-muted">
                            {tSettings("externalLlmHint.prefix")}{" "}
                            <span className="font-medium text-fg-2">{tSettings("externalLlmHint.link")}</span>
                            {tSettings("externalLlmHint.suffix")}
                          </p>
                        )}
                      </div>
                    ) : (
                      <Select
                        value=""
                        onChange={setSelectedModel}
                        options={[{ value: "", label: tSettings("modelLoading") }]}
                      />
                    )}
                  </FieldRow>
                  <FieldRow
                    title={tSettings("imageGeneration.title")}
                    description={tSettings("imageGeneration.description")}
                  >
                    {modelsData?.imageModel ? (
                      <Badge tone="neutral">
                        <span className="font-mono">{modelsData.imageModel}</span>
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted">{tSettings("notConfigured")}</span>
                    )}
                  </FieldRow>
                  <FieldRow
                    title={tSettings("responseStyle.title")}
                    description={tSettings("responseStyle.description")}
                  >
                    <Segment
                      value={responseStyle}
                      onChange={setResponseStyle}
                      options={RESPONSE_STYLES.map((s) => ({
                        value: s.value,
                        label: tSettings(s.labelKey),
                      }))}
                    />
                  </FieldRow>
                  <div className="py-4">
                    <h4 className="text-sm font-medium text-fg">
                      {tSettings("customInstructions.title")}
                    </h4>
                    <p className="mt-0.5 text-xs text-muted">
                      {tSettings("customInstructions.description")}
                    </p>
                    <textarea
                      value={customInstructions}
                      onChange={(e) =>
                        setCustomInstructions(
                          e.target.value.slice(0, CUSTOM_INSTRUCTIONS_MAX),
                        )
                      }
                      rows={6}
                      placeholder={tSettings("customInstructions.placeholder")}
                      className="mt-3 w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-accent"
                    />
                    <p className="mt-1 text-right text-xs text-faint">
                      {tSettings("customInstructions.charCount", {
                        count: customInstructions.length,
                        max: CUSTOM_INSTRUCTIONS_MAX,
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>
              <ProviderKeysSection />
              <ModelRolesSection />
              </>
            )}

            {tab === "interface" && (
              <Card>
                <CardHeader>
                  <CardTitle>{tSettings("tabs.interface")}</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title={tSettings("theme.title")}
                    description={tSettings("theme.description")}
                  >
                    <Select
                      value={theme}
                      onChange={setTheme}
                      options={THEMES.map((th) => ({
                        value: th.value,
                        label: tSettings(th.labelKey),
                      }))}
                    />
                  </FieldRow>
                </CardContent>
              </Card>
            )}

            {tab === "notifications" && (
              <Card>
                <CardHeader>
                  <CardTitle>{tSettings("tabs.notifications")}</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title={tSettings("emailAlerts.title")}
                    description={tSettings("emailAlerts.description")}
                  >
                    <Toggle checked={emailAlerts} onChange={setEmailAlerts} />
                  </FieldRow>
                  <FieldRow
                    title={tSettings("pushAlerts.title")}
                    description={tSettings("pushAlerts.description")}
                  >
                    {pushSupported === false ? (
                      <p className="text-xs text-muted">
                        {tSettings("pushNotSupported")}
                      </p>
                    ) : pushSupported === true && !pushSwReady ? (
                      <p className="text-xs text-muted">
                        {tSettings("pushSwNotReady")}
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Toggle
                          checked={pushAlerts}
                          onChange={(v) => void handlePushToggle(v)}
                        />
                        {pushLoading && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted" />
                        )}
                      </div>
                    )}
                  </FieldRow>
                </CardContent>
              </Card>
            )}

            {tab === "memory" && <MemorySection />}

            {tab === "connectors" && (
              <div className="space-y-6">
                <GithubConnectSection />
                <ConnectorsSection />
              </div>
            )}

            {tab === "privacy" && (
              <Card>
                <CardHeader>
                  <CardTitle>{tSettings("tabs.privacy")}</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title={tSettings("memoryLearning.title")}
                    description={tSettings("memoryLearning.description")}
                  >
                    <Toggle
                      checked={memoryLearning}
                      onChange={setMemoryLearning}
                    />
                  </FieldRow>
                  <FieldRow
                    title={tSettings("saveHistory.title")}
                    description={tSettings("saveHistory.descriptionPrivacy")}
                  >
                    <Toggle checked={saveHistory} onChange={setSaveHistory} />
                  </FieldRow>
                  <FieldRow
                    title={tSettings("dataExport.title")}
                    description={tSettings("dataExport.description")}
                  >
                    <button
                      type="button"
                      onClick={handleExport}
                      disabled={exporting}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:opacity-50"
                    >
                      {exporting ? tSettings("dataExport.exporting") : tSettings("dataExport.button")}
                    </button>
                  </FieldRow>
                  {consents.map((c) => (
                    <FieldRow
                      key={c.type}
                      title={tSettings(`consent.${c.type}` as "consent.privacy_policy")}
                      description={c.granted ? tSettings("consent.granted") : tSettings("consent.withdrawn")}
                    >
                      {c.granted ? (
                        <button
                          type="button"
                          onClick={() => void handleWithdraw(c)}
                          disabled={consentBusy === c.type}
                          className="rounded-md border border-danger/40 px-3 py-1.5 text-sm font-medium text-danger transition hover:bg-danger-soft disabled:opacity-50"
                        >
                          {consentBusy === c.type ? tSettings("consent.withdrawing") : tSettings("consent.withdraw")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleGrant(c)}
                          disabled={consentBusy === c.type}
                          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-fg transition hover:bg-surface-2 disabled:opacity-50"
                        >
                          {consentBusy === c.type ? tSettings("consent.granting") : tSettings("consent.regrant")}
                        </button>
                      )}
                    </FieldRow>
                  ))}
                  {consents.length > 0 && (
                    <p className="pb-3 pt-1 text-xs text-muted">{tSettings("consent.note")}</p>
                  )}
                </CardContent>
              </Card>
            )}

            {tab === "security" && (
              <Card>
                <CardHeader>
                  <CardTitle>{tSettings("passwordChange.title")}</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  {pwMessage && (
                    <div
                      className={cn(
                        "my-4 rounded-md px-3 py-2 text-xs",
                        pwMessage.ok
                          ? "bg-success-soft text-success"
                          : "bg-danger-soft text-danger",
                      )}
                    >
                      {pwMessage.text}
                    </div>
                  )}
                  <FieldRow title={tSettings("password.current")}>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
                    />
                  </FieldRow>
                  <FieldRow title={tSettings("password.new")} description={tSettings("password.newHint")}>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
                    />
                  </FieldRow>
                  <FieldRow title={tSettings("password.confirm")}>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
                    />
                  </FieldRow>
                  <div className="py-4">
                    <Button
                      onClick={() => void handlePasswordChange()}
                      disabled={pwSaving || !currentPassword || !newPassword || !confirmPassword}
                    >
                      {pwSaving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      {tSettings("passwordChange.title")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Toggle ─────────────────────────────────────────────── */
function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-pill transition",
        checked ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-pill bg-white shadow-1 transition",
          checked ? "translate-x-5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
