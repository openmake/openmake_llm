"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Search, Bell, BellRing, Cpu, Save, RotateCcw, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import {
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
} from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 (백엔드 /api/admin/system-settings) ── */
type SettingGroup = "oauth" | "search" | "alerts" | "push" | "llm";
interface SettingView {
  key: string;
  group: SettingGroup;
  secret: boolean;
  requiresRestart: boolean;
  source: "db" | "env" | "default";
  isSet: boolean;
  value?: string;
  /** 키 발급 콘솔 URL — 있으면 바로가기 링크 노출 */
  issueUrl?: string;
  /** 외부 provider 연동 키 — 관리자 본인의 BYOK 행이 활성이면 true (설정 화면 등록분 포함) */
  byokActive?: boolean;
  /** byokActive 시 해당 키 prefix (마스킹 표시) */
  byokKeyPrefix?: string;
}
interface SettingsPayload {
  settings: SettingView[];
}

const GROUP_ORDER: SettingGroup[] = ["llm", "oauth", "search", "alerts", "push"];
const GROUP_ICONS: Record<SettingGroup, typeof KeyRound> = {
  oauth: KeyRound,
  search: Search,
  alerts: Bell,
  push: BellRing,
  llm: Cpu,
};

const inputCls =
  "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";

/** 설정 1행 — 출처 뱃지 + 입력 + 저장/초기화 */
function SettingRow({ setting, busy, onSave, onReset }: {
  setting: SettingView;
  busy: boolean;
  onSave: (key: string, value: string) => void;
  onReset: (key: string) => void;
}) {
  const t = useTranslations("adminSystemSettings");
  const [draft, setDraft] = useState("");

  // 비시크릿은 현재 유효값을 프리필 — 시크릿은 항상 빈 입력(write-only)
  useEffect(() => {
    if (!setting.secret) setDraft(setting.value ?? "");
  }, [setting.secret, setting.value]);

  const sourceTone = setting.source === "db" ? "accent" : setting.source === "env" ? "neutral" : "neutral";
  const sourceLabel =
    setting.source === "db" ? t("sourceDb") : setting.source === "env" ? t("sourceEnv") : t("sourceDefault");
  const changed = setting.secret ? draft.trim().length > 0 : draft.trim() !== (setting.value ?? "");

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
      <div className="flex min-w-72 flex-wrap items-center gap-2">
        <code className="text-xs font-medium">{setting.key}</code>
        {setting.issueUrl && (
          <a
            href={setting.issueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-accent hover:underline"
            title={setting.issueUrl}
          >
            <ExternalLink className="h-3 w-3" aria-hidden />
            {t("issueLink")}
          </a>
        )}
        <Badge tone={sourceTone} className="shrink-0 whitespace-nowrap">{sourceLabel}</Badge>
        {setting.byokActive && (
          <Badge tone="accent" className="shrink-0 whitespace-nowrap" title={setting.byokKeyPrefix}>
            {t("byokLinked")}
          </Badge>
        )}
        {setting.requiresRestart && (
          <Badge tone="warn" className="shrink-0 whitespace-nowrap">{t("restartRequired")}</Badge>
        )}
      </div>
      <input
        className={inputCls}
        type={setting.secret ? "password" : "text"}
        autoComplete="off"
        placeholder={
          setting.secret
            ? (setting.isSet || setting.byokActive) ? t("secretSetPlaceholder") : t("secretUnsetPlaceholder")
            : t("valuePlaceholder")
        }
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex shrink-0 gap-1">
        <Button size="sm" className="whitespace-nowrap" disabled={busy || !changed}
          onClick={() => onSave(setting.key, draft.trim())}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("save")}
        </Button>
        {setting.source === "db" && (
          <Button variant="ghost" size="sm" className="whitespace-nowrap" disabled={busy}
            aria-label={t("reset")} title={t("resetHelp")}
            onClick={() => onReset(setting.key)}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t("reset")}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * 운영 설정(system_settings) 관리 — admin 전용.
 * 우선순위 DB > env > 기본값. 시크릿은 write-only(값 재조회 불가), 변경은 audit 기록.
 */
export default function AdminSystemSettingsPage() {
  const t = useTranslations("adminSystemSettings");
  const [settings, setSettings] = useState<SettingView[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restartKeys, setRestartKeys] = useState<string[]>([]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<SettingsPayload>>("/api/admin/system-settings");
      setSettings(r?.data?.settings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function save(key: string, value: string) {
    setBusyKey(key);
    setError(null);
    try {
      const r = await ApiClient.put<ApiSuccess<SettingsPayload & { requiresRestart: string[] }>>(
        "/api/admin/system-settings",
        { entries: { [key]: value } },
      );
      if (r?.data?.requiresRestart?.length) {
        setRestartKeys((prev) => [...new Set([...prev, ...r.data.requiresRestart])]);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(key: string) {
    if (!window.confirm(t("resetConfirm", { key }))) return;
    setBusyKey(key);
    setError(null);
    try {
      await ApiClient.del(`/api/admin/system-settings/${key}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<SettingGroup, SettingView[]>();
    for (const g of GROUP_ORDER) map.set(g, []);
    for (const s of settings) map.get(s.group)?.push(s);
    return map;
  }, [settings]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <AdminTabs />
      {/* workspace layout(main)이 overflow-hidden 이라 페이지가 자체 스크롤 컨테이너를 가져야 함
          (admin/alerts 등과 동일 관용구 — 누락 시 뷰포트 아래 내용 접근 불가) */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-6">
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {restartKeys.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
          <span>{t("restartNotice", { keys: restartKeys.join(", ") })}</span>
        </div>
      )}

      {GROUP_ORDER.map((group) => {
        const items = grouped.get(group) ?? [];
        if (items.length === 0) return null;
        const Icon = GROUP_ICONS[group];
        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Icon className="h-4 w-4" aria-hidden />
                {t(`groups.${group}.title`)}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{t(`groups.${group}.description`)}</p>
              {items.map((s) => (
                <SettingRow key={s.key} setting={s} busy={busyKey === s.key} onSave={save} onReset={reset} />
              ))}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-xs text-muted-foreground">{t("priorityNote")}</p>
        </div>
      </div>
    </>
  );
}
