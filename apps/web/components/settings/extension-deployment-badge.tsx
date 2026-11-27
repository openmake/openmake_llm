"use client";

/**
 * 조직 배포 모드 배지(§8-1) — 갤러리 조직 항목(`deployment_mode`)·설치 목록 행(`org_deployment.mode`)에 붙는다.
 * default_off(갤러리에만)는 배지를 그리지 않는다. 서버 플래그가 꺼져 있으면 필드가 오지 않아 아무것도 그리지 않는다.
 */
import { useTranslations } from "next-intl";

export type ExtensionDeploymentMode = "default_off" | "default_on" | "required";

export interface ExtensionOrgDeployment {
  mode: ExtensionDeploymentMode;
  /** false 면 제거 버튼을 비활성화한다(required + 일반 멤버) */
  removable: boolean;
}

export function DeploymentModeBadge({ mode }: { mode?: ExtensionDeploymentMode | null }) {
  const t = useTranslations("extensions.deployment");
  if (mode !== "required" && mode !== "default_on") return null;
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${
        mode === "required" ? "border-warn text-warn" : "border-accent text-accent"
      }`}
      title={mode === "required" ? t("requiredHint") : t("defaultOnHint")}
    >
      {mode === "required" ? t("required") : t("defaultOn")}
    </span>
  );
}
