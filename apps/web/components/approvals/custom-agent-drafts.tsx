"use client";

/**
 * Custom Agent 승인 — 두 출처를 한 목록으로 보인다.
 *  - Git URL 가져오기(`/api/agents/custom/import-from-git`) draft — `custom_agents`
 *  - 확장(플러그인) 설치로 들어온 Custom Agent — `user_agents.approval_status='pending'`(206, opt-in `EXTENSION_AGENT_APPROVAL_REQUIRED`;
 *    꺼져 있으면 확장 설치분은 종전대로 즉시 활성이라 이 목록은 비어 있다).
 *    외부 저장소의 시스템 프롬프트라 승인 전에 본문을 펼쳐 볼 수 있게 한다.
 *
 * 구 `/custom-agents` 의 "Draft 검토" 탭을 옮겨 온 것 — 승인 창구를 `/approvals` 한 곳으로
 * 모으는 원칙(2026-08-25 #615)에서 이 축만 빠져 있었다.
 *
 * @see app/(workspace)/approvals/page.tsx
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Bot, Check, X } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { formatExtensionOrigin as formatOrigin } from "@/lib/extension-origin";
import type { ApiSuccess } from "@openmake/shared-types";

interface ApiCustomAgentDraft {
  id: string;
  name: string;
  description: string | null;
  status?: string;
}

type DraftAgentsResponse = ApiSuccess<{ drafts: ApiCustomAgentDraft[]; total: number }>;

interface ApiPendingUserAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  /** 승인 대기 설치 opt-in 일 때만 온다 — 어느 확장·원본·커밋에서 왔는지 */
  extension_name?: string | null;
  extension_source_url?: string | null;
  extension_source_ref?: string | null;
}
type PendingUserAgentsResponse = ApiSuccess<{ agents: ApiPendingUserAgent[]; total: number }>;

/** 항목별 승인·거절 엔드포인트 — 출처에 따라 다르다 */
type DraftItem = {
  id: string; name: string; description: string | null; systemPrompt?: string; base: string;
  origin?: { extension: string | null; source: string | null; ref: string | null };
};

export function CustomAgentDrafts({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("customAgents");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    // 한 출처의 조회 실패가 다른 출처 목록을 지우지 않게 따로 받는다
    const [git, ext] = await Promise.all([
      ApiClient.get<DraftAgentsResponse>("/api/agents/custom/drafts?target=user")
        .then((r) => r?.data?.drafts ?? []).catch(() => [] as ApiCustomAgentDraft[]),
      ApiClient.get<PendingUserAgentsResponse>("/api/users/me/agents/pending")
        .then((r) => r?.data?.agents ?? []).catch(() => [] as ApiPendingUserAgent[]),
    ]);
    setDrafts([
      ...ext.map((a) => ({
        id: a.id, name: a.name, description: a.description, systemPrompt: a.system_prompt, base: "/api/users/me/agents",
        ...(a.extension_name !== undefined
          ? { origin: { extension: a.extension_name ?? null, source: a.extension_source_url ?? null, ref: a.extension_source_ref ?? null } }
          : {}),
      })),
      ...git.map((d) => ({ id: d.id, name: d.name, description: d.description, base: "/api/agents/custom" })),
    ]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  async function handleApprove(d: DraftItem) {
    try {
      await ApiClient.post(`${d.base}/${encodeURIComponent(d.id)}/approve`, {});
      await loadDrafts();
      onRefreshAction?.();
    } catch (err) {
      alert(t("approveFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function handleReject(d: DraftItem) {
    if (!window.confirm(t("rejectConfirm"))) return;
    try {
      await ApiClient.post(`${d.base}/${encodeURIComponent(d.id)}/reject`, {});
      await loadDrafts();
      onRefreshAction?.();
    } catch (err) {
      alert(t("rejectFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  if (loading) {
    return <p className="py-6 text-center text-sm text-muted">{t("loadingDrafts")}</p>;
  }

  if (drafts.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{t("noDraftsTitle")}</p>;
  }

  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <Card key={`${d.base}:${d.id}`} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone="warn">Draft</Badge>
                <Bot className="h-3.5 w-3.5 text-faint" />
                {d.origin?.extension && <Badge tone="neutral">{d.origin.extension}</Badge>}
              </div>
              <h3 className="text-sm font-semibold text-fg">{d.name}</h3>
              {d.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted">{d.description}</p>
              )}
              {d.origin && formatOrigin(d.origin.source, d.origin.ref) && (
                <p className="mt-1 truncate font-mono text-xs text-muted" title={d.origin.source ?? undefined}>
                  {t("agentOrigin", { source: formatOrigin(d.origin.source, d.origin.ref) ?? "" })}
                </p>
              )}
              {d.systemPrompt && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-accent">{t("viewSystemPrompt")}</summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-xs text-fg">{d.systemPrompt}</pre>
                </details>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => void handleApprove(d)}>
                <Check className="h-3.5 w-3.5" />{t("approve")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleReject(d)}>
                <X className="h-3.5 w-3.5" />{t("reject")}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
