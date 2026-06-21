"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Bot,
  Palette,
  Bell,
  ShieldCheck,
  Save,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  PageHeader,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/* ── 탭 정의 ────────────────────────────────────────────── */
type TabId = "general" | "model" | "interface" | "notifications" | "privacy";

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "일반", icon: Settings },
  { id: "model", label: "모델 & 응답", icon: Bot },
  { id: "interface", label: "인터페이스", icon: Palette },
  { id: "notifications", label: "알림", icon: Bell },
  { id: "privacy", label: "개인정보", icon: ShieldCheck },
];

const MODEL_PROFILES = [
  { value: "default", label: "Default (Auto)" },
  { value: "pro", label: "Pro" },
  { value: "fast", label: "Fast" },
  { value: "think", label: "Think" },
  { value: "code", label: "Code" },
  { value: "vision", label: "Vision" },
];

const RESPONSE_STYLES = [
  { value: "concise", label: "간결" },
  { value: "default", label: "기본" },
  { value: "verbose", label: "상세" },
] as const;

const THEMES = [
  { value: "system", label: "시스템 설정" },
  { value: "light", label: "라이트" },
  { value: "dark", label: "다크" },
];

const LANGUAGES = [
  { value: "", label: "자동 감지" },
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

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-fg outline-none transition focus:border-accent"
    >
      {options.map((o) => (
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
  const [tab, setTab] = useState<TabId>("general");

  // 일반 / 모델
  const [defaultModel, setDefaultModel] = useState("default");
  const [responseStyle, setResponseStyle] =
    useState<(typeof RESPONSE_STYLES)[number]["value"]>("default");
  const [language, setLanguage] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  // 인터페이스
  const [theme, setTheme] = useState("system");

  // 알림
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [pushAlerts, setPushAlerts] = useState(false);

  // 개인정보
  const [saveHistory, setSaveHistory] = useState(true);
  const [memoryLearning, setMemoryLearning] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // custom-instructions 만 실제 API 연동 (나머지는 로컬/목업)
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
      } finally {
        if (alive) setLoading(false);
      }
    })();
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
      // TODO: API 연동 — defaultModel/responseStyle/language/theme/알림/개인정보 영속화
      setSavedAt(new Date().toLocaleTimeString("ko-KR"));
    } catch {
      setSavedAt(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title="설정"
        description="앱 환경과 AI 모델 동작을 구성합니다."
        actions={
          <div className="flex items-center gap-3">
            {savedAt && (
              <span className="text-xs text-muted">{savedAt} 저장됨</span>
            )}
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              설정 저장
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
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition",
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-fg-2 hover:bg-surface-2 hover:text-fg",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>

          {/* 우측 폼 */}
          <div className="min-w-0 flex-1 space-y-6">
            {tab === "general" && (
              <Card>
                <CardHeader>
                  <CardTitle>일반</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title="언어"
                    description="AI 응답 언어. 자동 감지 시 사용자 메시지 언어로 응답합니다."
                  >
                    <Select
                      value={language}
                      onChange={setLanguage}
                      options={LANGUAGES}
                    />
                  </FieldRow>
                  <FieldRow
                    title="대화 본문 저장"
                    description="대화 내용을 서버 DB에 저장합니다. 끄면 익명 사용량 메타만 기록됩니다."
                  >
                    <Toggle checked={saveHistory} onChange={setSaveHistory} />
                  </FieldRow>
                </CardContent>
              </Card>
            )}

            {tab === "model" && (
              <Card>
                <CardHeader>
                  <CardTitle>모델 & 응답</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title="기본 모델 프로파일"
                    description="새 대화에 기본으로 사용할 모델 프로파일입니다."
                  >
                    <Select
                      value={defaultModel}
                      onChange={setDefaultModel}
                      options={MODEL_PROFILES}
                    />
                  </FieldRow>
                  <FieldRow
                    title="응답 스타일"
                    description="응답의 자세함 정도를 조절합니다."
                  >
                    <Segment
                      value={responseStyle}
                      onChange={setResponseStyle}
                      options={RESPONSE_STYLES}
                    />
                  </FieldRow>
                  <div className="py-4">
                    <h4 className="text-sm font-medium text-fg">
                      사용자 지시문 (Custom Instructions)
                    </h4>
                    <p className="mt-0.5 text-xs text-muted">
                      모든 대화에 영구 적용되는 system prompt 추가 지시문입니다.
                    </p>
                    <textarea
                      value={customInstructions}
                      onChange={(e) =>
                        setCustomInstructions(
                          e.target.value.slice(0, CUSTOM_INSTRUCTIONS_MAX),
                        )
                      }
                      rows={6}
                      placeholder="예: 사용자가 명시적으로 요청하지 않은 부가 정보는 출력하지 않는다."
                      className="mt-3 w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg outline-none transition focus:border-accent"
                    />
                    <p className="mt-1 text-right text-xs text-faint">
                      {customInstructions.length} / {CUSTOM_INSTRUCTIONS_MAX} 자
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {tab === "interface" && (
              <Card>
                <CardHeader>
                  <CardTitle>인터페이스</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title="테마"
                    description="앱의 색상 테마를 선택합니다."
                  >
                    <Select value={theme} onChange={setTheme} options={THEMES} />
                  </FieldRow>
                </CardContent>
              </Card>
            )}

            {tab === "notifications" && (
              <Card>
                <CardHeader>
                  <CardTitle>알림</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title="이메일 알림"
                    description="에이전트 작업 완료 및 보안 이벤트를 이메일로 받습니다."
                  >
                    <Toggle checked={emailAlerts} onChange={setEmailAlerts} />
                  </FieldRow>
                  <FieldRow
                    title="푸시 알림"
                    description="브라우저 푸시로 실시간 알림을 받습니다."
                  >
                    <Toggle checked={pushAlerts} onChange={setPushAlerts} />
                  </FieldRow>
                </CardContent>
              </Card>
            )}

            {tab === "privacy" && (
              <Card>
                <CardHeader>
                  <CardTitle>개인정보</CardTitle>
                </CardHeader>
                <CardContent className="py-0">
                  <FieldRow
                    title="장기 기억 학습"
                    description="대화에서 이름·직업·선호 같은 사실을 추출하여 저장합니다."
                  >
                    <Toggle
                      checked={memoryLearning}
                      onChange={setMemoryLearning}
                    />
                  </FieldRow>
                  <FieldRow
                    title="대화 본문 저장"
                    description="끄면 대화 본문은 서버에 저장되지 않습니다."
                  >
                    <Toggle checked={saveHistory} onChange={setSaveHistory} />
                  </FieldRow>
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
