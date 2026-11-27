"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ApiClient } from "@/lib/api-client";
import { Badge } from "@/components/ui/primitives";
import { buildVerdictViews } from "../verdict-view";

/** 원본 하나의 판정 — 같은 원본의 항목들이 이 쿼리를 함께 쓴다(요청 1회) */
function useCatalogVerdicts(catalogId: string) {
  return useQuery({
    queryKey: ["extension-marketplace", "verdicts", catalogId],
    queryFn: async () => {
      const r = await ApiClient.get<{ data?: { verdicts?: unknown } }>(
        `/api/extension-marketplace/verdicts?catalogId=${encodeURIComponent(catalogId)}`,
        { redirectOnUnauthorized: false },
      );
      return buildVerdictViews(r.data?.verdicts);
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/** 갤러리 항목 옆 호환 배지 — 조회 실패·판정 없음이면 아무것도 그리지 않는다(갤러리는 그대로) */
export function VerdictBadge({ catalogId, pluginName }: { catalogId: string; pluginName: string }) {
  const t = useTranslations("marketVerdicts");
  const { data } = useCatalogVerdicts(catalogId);
  const view = data?.get(pluginName);
  const title = useMemo(() => {
    if (!view) return "";
    const label = (c: string) => (t.has(`reason.${c}`) ? t(`reason.${c}`) : c);
    const lines: string[] = [];
    for (const c of view.causes) lines.push(`• ${label(c)}`);
    for (const c of view.notes) lines.push(`· ${label(c)}`);
    const prov = [
      view.publisher ? t("provenance.publisher", { value: view.publisher }) : null,
      view.shortCommit ? t("provenance.commit", { value: view.shortCommit }) : null,
      view.license ? t("provenance.license", { value: view.license }) : null,
    ].filter(Boolean);
    if (prov.length) lines.push(prov.join(" · "));
    if (view.snapshotOnly) lines.push(t("snapshotOnly"));
    return lines.join("\n");
  }, [view, t]);
  if (!view) return null;
  const verdictLabel = t(`verdict.${view.verdict}`);
  return (
    <Badge tone={view.tone} className="ml-1.5 align-middle" title={title} aria-label={title ? `${verdictLabel}. ${title}` : verdictLabel}>
      {verdictLabel}
    </Badge>
  );
}
