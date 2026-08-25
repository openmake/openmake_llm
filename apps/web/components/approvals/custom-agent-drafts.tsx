"use client";

/**
 * Custom Agent draft 승인 — Git URL 가져오기(`/api/agents/custom/import-from-git`)로 만든
 * 에이전트만 draft 를 거친다(확장 설치분은 승인 없이 즉시 활성 — `user_agents`).
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
import type { ApiSuccess } from "@openmake/shared-types";

interface ApiCustomAgentDraft {
  id: string;
  name: string;
  description: string | null;
  status?: string;
}

type DraftAgentsResponse = ApiSuccess<{ drafts: ApiCustomAgentDraft[]; total: number }>;

export function CustomAgentDrafts({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("customAgents");
  const [drafts, setDrafts] = useState<ApiCustomAgentDraft[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<DraftAgentsResponse>("/api/agents/custom/drafts?target=user");
      setDrafts(res?.data?.drafts ?? []);
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  async function handleApprove(agentId: string) {
    try {
      await ApiClient.post(`/api/agents/custom/${agentId}/approve`, {});
      await loadDrafts();
      onRefreshAction?.();
    } catch (err) {
      alert(t("approveFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function handleReject(agentId: string) {
    if (!window.confirm(t("rejectConfirm"))) return;
    try {
      await ApiClient.post(`/api/agents/custom/${agentId}/reject`, {});
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
        <Card key={d.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone="warn">Draft</Badge>
                <Bot className="h-3.5 w-3.5 text-faint" />
              </div>
              <h3 className="text-sm font-semibold text-fg">{d.name}</h3>
              {d.description && (
                <p className="mt-1 line-clamp-2 text-xs text-muted">{d.description}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" onClick={() => void handleApprove(d.id)}>
                <Check className="h-3.5 w-3.5" />{t("approve")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleReject(d.id)}>
                <X className="h-3.5 w-3.5" />{t("reject")}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
