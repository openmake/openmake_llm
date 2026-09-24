"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Trash2, Save, Loader2 } from "lucide-react";
import {
  PageHeader,
  PageBody,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import { AdminTabs } from "@/components/hub-tabs";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { ModelAssignmentsSection } from "@/components/settings/model-assignments-section";
import { GatewayModelsCard } from "@/components/admin/gateway-models-card";

/* ── 타입 (백엔드 /api/admin/server-external-keys) ── */
interface ServerKeyRow {
  providerId: string;
  baseUrl: string | null;
  isActive: boolean;
  dailyTokenLimit: number;
  monthlyTokenLimit: number | null;
  updatedAt: string;
}
interface ServerKeysPayload {
  keys: ServerKeyRow[];
  providers: { id: string; displayName: string; defaultBaseUrl: string }[];
}

const inputCls =
  "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";
const selectCls =
  "h-9 rounded-md border border-border bg-surface-2 px-2 text-sm text-fg focus:border-accent focus:outline-none";

/** 서버 공용 키 등록 폼 */
function ServerKeyForm({ providers, onSaved }: {
  providers: ServerKeysPayload["providers"];
  onSaved: () => void;
}) {
  const t = useTranslations("adminModelRoles");
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [apiKey, setApiKey] = useState("");
  const [dailyLimit, setDailyLimit] = useState("100000");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await ApiClient.put(`/api/admin/server-external-keys/${providerId}`, {
        apiKey,
        dailyTokenLimit: Number(dailyLimit),
      });
      setApiKey("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className={selectCls} value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label={t("keyForm.provider")}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.displayName}</option>
          ))}
        </select>
        <input
          className={inputCls}
          type="password"
          placeholder={t("keyForm.apiKeyPlaceholder")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
        <input
          className={`${inputCls} sm:w-40`}
          type="number"
          min={0}
          title={t("keyForm.dailyLimit")}
          value={dailyLimit}
          onChange={(e) => setDailyLimit(e.target.value)}
        />
        <Button size="sm" className="shrink-0 whitespace-nowrap" disabled={saving || apiKey.length < 8} onClick={() => void handleSave()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
          {t("keyForm.save")}
        </Button>
      </div>
      <p className="text-xs text-muted">{t("keyForm.dailyLimitHelp")}</p>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
    </div>
  );
}

/**
 * 관리자 — 게이트웨이 모델 · 서버 공용 외부 키 · 전역 모델 배정(scope=global).
 * 종전의 "전역 역할 매핑"·"전역 기능별 배정" 두 카드는 통합 슬롯 배정(ModelAssignmentsSection)으로 합쳐졌다.
 * 변경은 재시작 없이 최대 60초 내 반영(resolver 캐시).
 */
export default function AdminModelRolesPage() {
  const t = useTranslations("adminModelRoles");
  const [serverKeys, setServerKeys] = useState<ServerKeysPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const k = await ApiClient.get<ApiSuccess<ServerKeysPayload>>("/api/admin/server-external-keys");
      setServerKeys(k?.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function deleteKey(providerId: string) {
    if (!window.confirm(t("keyDeleteConfirm", { provider: providerId }))) return;
    try {
      await ApiClient.del(`/api/admin/server-external-keys/${providerId}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    }
  }

  return (
    // 워크스페이스 레이아웃의 <main> 은 h-dvh + overflow-hidden 이라(채팅이 자체 스크롤 영역을
    // 갖는 전제) 페이지가 스크롤 컨테이너를 직접 만들어야 한다 — 없으면 본문이 뷰포트 밖에서
    // 통째로 잘린다(2026-09-13 신고: 1280×900 에서 1,314px 접근 불가). 헤더·탭은 고정.
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <AdminTabs />

      <PageBody className="space-y-6">
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <GatewayModelsCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" aria-hidden />
            {t("serverKeys.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted">{t("serverKeys.description")}</p>
          {serverKeys && serverKeys.keys.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>{t("serverKeys.provider")}</Th>
                  <Th>{t("serverKeys.dailyLimit")}</Th>
                  <Th>{t("serverKeys.status")}</Th>
                  <Th>{t("serverKeys.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {serverKeys.keys.map((k) => (
                  <tr key={k.providerId}>
                    <Td>{k.providerId}</Td>
                    <Td>{k.dailyTokenLimit.toLocaleString()}</Td>
                    <Td>
                      <Badge tone={k.isActive ? "success" : "neutral"}>
                        {k.isActive ? t("serverKeys.active") : t("serverKeys.inactive")}
                      </Badge>
                    </Td>
                    <Td>
                      <Button variant="ghost" size="sm" aria-label={t("serverKeys.delete")}
                        onClick={() => void deleteKey(k.providerId)}>
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {serverKeys && <ServerKeyForm providers={serverKeys.providers} onSaved={() => void load()} />}
        </CardContent>
      </Card>

      <ModelAssignmentsSection scope="global" />
      </PageBody>
    </>
  );
}
