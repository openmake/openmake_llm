"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UsersRound, Loader2, RotateCcw } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { fetchModels, type ModelEntry } from "@/lib/models-api";

/* ── 타입 (백엔드 /api/users/me/model-roles 응답) ─────────── */
interface RoleMapping {
  role: string;
  fullModelId: string;
  updatedAt: string;
}

interface ModelRolesPayload {
  mappings: RoleMapping[];
  assignableRoles: string[];
}

/** 매핑 미지정 select 값 — 전역/기본 모델로 자동 해석됨 */
const DEFAULT_VALUE = "";

/**
 * 역할별 모델 배정 (Role-based Multi-Agent Orchestration) — 설정 '모델' 탭.
 * 등록된 모델(로컬 + BYOK 외부)을 agent/judge/research/spawn/review 역할에 배정한다.
 * 미배정 role 은 서버 기본 모델로 자동 해석되고, 외부 모델 호출 실패 시
 * 서버가 로컬 기본 모델로 fail-open 폴백한다.
 */
export function ModelRolesSection() {
  const t = useTranslations("modelRoles");
  const [mappings, setMappings] = useState<RoleMapping[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rolesRes, modelsRes] = await Promise.all([
        ApiClient.get<ApiSuccess<ModelRolesPayload>>("/api/users/me/model-roles"),
        fetchModels({ usableOnly: true }),
      ]);
      setMappings(rolesRes?.data?.mappings ?? []);
      setRoles(rolesRes?.data?.assignableRoles ?? []);
      setModels(modelsRes.models);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
      setMappings([]);
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  async function handleChange(role: string, fullModelId: string) {
    setSavingRole(role);
    setError(null);
    try {
      if (fullModelId === DEFAULT_VALUE) {
        // 매핑이 있을 때만 해제 (없으면 404 — 이미 기본 상태)
        if (mappings.some((m) => m.role === role)) {
          await ApiClient.del(`/api/users/me/model-roles/${role}`);
        }
      } else {
        await ApiClient.put(`/api/users/me/model-roles/${role}`, {
          model: fullModelId,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveFailed"));
    } finally {
      setSavingRole(null);
    }
  }

  const mapped = new Map(mappings.map((m) => [m.role, m.fullModelId]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersRound className="h-4 w-4" aria-hidden />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("description")}</p>
        <p className="text-xs text-muted-foreground">{t("externalNote")}</p>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : (
          <div className="space-y-3">
            {roles.map((role) => {
              const current = mapped.get(role) ?? DEFAULT_VALUE;
              const saving = savingRole === role;
              return (
                <div
                  key={role}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-sm font-medium">
                        {t(`roles.${role}.label`)}
                      </span>
                      {current !== DEFAULT_VALUE && (
                        <Badge tone="accent" className="shrink-0 whitespace-nowrap">
                          {t("assignedBadge")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(`roles.${role}.description`)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {saving && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                    )}
                    <select
                      className="h-9 min-w-52 rounded-md border bg-background px-2 text-sm"
                      value={current}
                      disabled={saving}
                      aria-label={t(`roles.${role}.label`)}
                      onChange={(e) => void handleChange(role, e.target.value)}
                    >
                      <option value={DEFAULT_VALUE}>{t("defaultOption")}</option>
                      {models.map((m) => (
                        <option key={m.modelId} value={m.modelId}>
                          {m.name}
                          {m.provider !== "local-llm" ? ` (${m.provider})` : ""}
                        </option>
                      ))}
                    </select>
                    {current !== DEFAULT_VALUE && !saving && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t("resetLabel")}
                        title={t("resetLabel")}
                        onClick={() => void handleChange(role, DEFAULT_VALUE)}
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
            {roles.length === 0 && !error && (
              <p className="text-sm text-muted-foreground">{t("empty")}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
