"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Button } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";
import {
  approveErrorKey,
  approveOutcomeMessages,
  extensionPermissionView,
  permissionBadgeKey,
  permissionFieldsFromView,
  permissionImpactKey,
  permissionLabelKey,
  permissionToneClass,
  type ApproveResponse,
  type ExtensionPermissionFields,
  type ExtensionPermissionKind,
  type PermissionMessage,
} from "@/lib/extension-permission-state";

type PermissionExtension = ExtensionPermissionFields & { id: string };

const ICONS: Record<Exclude<ExtensionPermissionKind, "unknown">, typeof ShieldCheck> = {
  reviewed: ShieldCheck,
  legacy: ShieldQuestion,
  reviewRequired: ShieldAlert,
};

/** 목록 행 머리의 권한 상태 배지 — 서버가 상태를 주지 않으면(구 API) 그리지 않는다 */
export function ExtensionPermissionBadge({ ext }: { ext: PermissionExtension }) {
  const t = useTranslations("extensions.permissions");
  const view = extensionPermissionView(ext);
  const key = permissionBadgeKey(view.kind);
  if (!key) return null;
  return (
    <span
      data-testid="ext-permission-badge"
      data-kind={view.kind}
      className={`shrink-0 whitespace-nowrap text-xs ${permissionToneClass(view.kind)}`}
    >
      {t(key)}
    </span>
  );
}

/** 상세 패널 — 요청 권한·막힌 권한·영향과 복구 안내·재승인 버튼 */
export function ExtensionPermissionPanel({
  ext,
  onUpdated,
}: {
  ext: PermissionExtension;
  onUpdated: (patch: ExtensionPermissionFields) => void;
}) {
  const t = useTranslations("extensions.permissions");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const view = extensionPermissionView(ext);
  if (view.kind === "unknown") return null;

  const Icon = ICONS[view.kind];
  const impactKey = permissionImpactKey(view.kind);
  const labelOf = (permission: string): string => {
    const key = permissionLabelKey(permission);
    return key ? t(key) : permission;
  };
  const requestedText = view.requested.length === 0 ? t("noneRequested") : view.requested.map(labelOf).join(", ");
  const messageText = (m: PermissionMessage): string => {
    if (m.key === "restored") return t("restored", { count: m.count });
    if (m.key === "reinstallRemote") return t("reinstallRemote", { names: m.names });
    return t("approved");
  };

  async function approve() {
    if (!window.confirm(t("approveConfirm", { perms: requestedText }))) return;
    setBusy(true);
    setMessages([]);
    try {
      const res = await ApiClient.post<ApiSuccess<ApproveResponse>>(
        `/api/users/me/extensions/${ext.id}/permissions/approve`,
        {},
      );
      if (res?.data) {
        onUpdated(permissionFieldsFromView(res.data.permissions));
        setMessages(approveOutcomeMessages(res.data).map(messageText));
      }
    } catch (e) {
      setMessages([t(approveErrorKey(e instanceof ApiError ? e.status : undefined))]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="ext-permission-panel">
      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-2">
        <Icon className={`h-3.5 w-3.5 ${permissionToneClass(view.kind)}`} /> {t("title")}
      </p>
      <p className="text-xs text-fg">
        {t("requested")}: {requestedText}
      </p>
      {view.blocked.length > 0 && (
        <p className="mt-0.5 text-xs text-warn">
          {t("blocked")}: {view.blocked.map(labelOf).join(", ")}
        </p>
      )}
      {impactKey && <p className="mt-1 text-xs leading-relaxed text-fg-2">{t(impactKey)}</p>}
      {view.canApprove && (
        <>
          <p className="mt-1 text-xs text-muted">{t("recovery")}</p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            data-testid="ext-permission-approve"
            disabled={busy}
            onClick={() => void approve()}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("approve")}
          </Button>
        </>
      )}
      {messages.map((m, i) => (
        <p key={i} className="mt-1 text-xs text-fg-2">
          {m}
        </p>
      ))}
    </div>
  );
}
