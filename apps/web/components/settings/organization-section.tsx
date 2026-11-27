"use client";

/**
 * 설정 → 일반: 활성 조직 스위처 (F22 Phase B-2).
 * 멤버십이 없으면 렌더하지 않는다(조직은 선택 구조). 활성 조직의 owner/admin 에겐 확장 배포 모드 패널(§8-1)을 함께 보인다. 변경 후 /api/auth/me 를 재동기화해
 * store 의 activeOrgId 가 곧바로 커스텀 에이전트·템플릿 화면의 공유 토글에 반영되게 한다.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, NativeSelect } from "@/components/ui/primitives";
import type { ApiSuccess, OrgMembership } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { syncAuthFromServer } from "@/lib/auth-sync";
import { OrgExtensionDeploymentsPanel } from "@/components/admin/org-extension-deployments";

type OrgsResponse = ApiSuccess<{ organizations: OrgMembership[]; activeOrgId: string | null }>;

export function OrganizationSection() {
  const t = useTranslations("settings.organization");
  const activeOrgId = useAppStore((s) => s.auth.currentUser?.activeOrgId ?? null);
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await ApiClient.get<OrgsResponse>("/api/users/me/organizations");
      setOrgs(r?.data?.organizations ?? []);
    } catch {
      setOrgs([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!orgs || orgs.length === 0) return null;

  // 활성 조직의 관리자(owner/admin)면 확장 배포 모드·그룹 패널(§8-1, opt-in — 꺼져 있으면 패널이 스스로 숨는다)
  const activeMembership = orgs.find((o) => o.orgId === activeOrgId);
  const canManage = activeMembership?.role === "owner" || activeMembership?.role === "admin";

  const roleLabel = (role: OrgMembership["role"]) =>
    role === "owner" ? t("roleOwner") : role === "admin" ? t("roleAdmin") : t("roleMember");

  async function change(value: string) {
    setBusy(true);
    try {
      await ApiClient.put("/api/users/me/active-organization", { orgId: value === "" ? null : value });
      await syncAuthFromServer();
    } catch (err) {
      alert(t("failed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-accent" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="py-0">
        <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted">{t("description")}</p>
          <NativeSelect
            aria-label={t("title")}
            value={activeOrgId ?? ""}
            disabled={busy}
            onChange={(e) => void change(e.target.value)}
            className="sm:max-w-xs sm:flex-1"
          >
            <option value="">{t("personal")}</option>
            {orgs.map((o) => (
              <option key={o.orgId} value={o.orgId}>
                {o.name} · {roleLabel(o.role)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canManage && activeOrgId && (
          <div className="border-t border-border py-4">
            <OrgExtensionDeploymentsPanel orgId={activeOrgId} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
