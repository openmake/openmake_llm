"use client";

/**
 * MCP 서버 행의 보조 상태 — "연결됨" 과 구분되는 두 가지를 따로 보인다.
 *   - 모델 노출: 서버 도구가 채팅 모델에 어떤 조건에서 실리는가 (백엔드 modelExposure,
 *     apps/api/src/addons/mcp-runtime/model-exposure.ts). 연결돼 있어도 모델이 못 쓸 수 있다.
 *   - 권한: 확장기능이 설치한 서버만 — 그 확장의 권한 승인 상태(user_extensions.permission_state).
 *     승인 전이거나 철회되면 네트워크가 막혀 연결은 돼도 외부 호출이 실패할 수 있다.
 */
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/primitives";
import { extensionPermissionView, permissionBadgeKey, type ExtensionPermissionKind } from "@/lib/extension-permission-state";

export interface ModelExposureView {
  state: "auto" | "on_mention" | "on_demand" | "none";
  reason?: "disabled" | "not_connected" | "no_tools" | "meta_tools_off";
  viaMetaTools: boolean;
}

type Tone = "accent" | "success" | "warn" | "danger" | "neutral";

const EXPOSURE_TONE: Record<ModelExposureView["state"], Tone> = {
  auto: "success",
  on_mention: "accent",
  on_demand: "neutral",
  none: "neutral",
};

const PERMISSION_TONE: Record<Exclude<ExtensionPermissionKind, "unknown">, Tone> = {
  reviewed: "success",
  legacy: "neutral",
  reviewRequired: "warn",
};

/** 백엔드가 모르는 값을 주면(구 API) 그리지 않는다 */
export function parseExposure(raw: unknown): ModelExposureView | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ModelExposureView>;
  if (!r.state || !(r.state in EXPOSURE_TONE)) return null;
  return { state: r.state, reason: r.reason, viaMetaTools: r.viaMetaTools === true };
}

export function ModelExposureBadge({ exposure }: { exposure: ModelExposureView | null }) {
  const t = useTranslations("mcpServers.exposure");
  if (!exposure) return null;
  const hint = exposure.state === "none" && exposure.reason
    ? t(`reason.${exposure.reason}`)
    : t(`hint.${exposure.state}`) + (exposure.state === "on_mention" && exposure.viaMetaTools ? ` ${t("hint.viaMetaTools")}` : "");
  return (
    <span data-testid="mcp-exposure-badge" data-state={exposure.state} title={hint}>
      <Badge tone={EXPOSURE_TONE[exposure.state]}>{t(`label.${exposure.state}`)}</Badge>
    </span>
  );
}

/** 확장 설치 서버의 권한 배지 — 확장 정보가 없으면(단독 설치·조회 실패) 그리지 않는다 */
export function ServerPermissionBadge({ permissionState }: { permissionState: string | null | undefined }) {
  const t = useTranslations("extensions.permissions");
  const kind = extensionPermissionView({ permission_state: permissionState ?? null }).kind;
  const key = permissionBadgeKey(kind);
  if (!key || kind === "unknown") return null;
  return (
    <span data-testid="mcp-permission-badge" data-kind={kind} title={t(`impact.${kind}`)}>
      <Badge tone={PERMISSION_TONE[kind]}>{t(key)}</Badge>
    </span>
  );
}
