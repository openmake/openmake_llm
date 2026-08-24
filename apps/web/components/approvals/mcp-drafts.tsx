"use client";

/**
 * MCP 서버 승인 대기 목록.
 *
 * 원래 설정 → 커넥터 → Draft 탭에만 있었다. 스킬 승인(/skill-library)과 위치가 달라
 * 사용자가 "어디서 승인하는지 모르겠다"고 하던 문제가 있어, 승인 창구를 `/approvals`
 * 한 곳으로 모으면서 이 컴포넌트로 분리했다.
 *
 * ⚠️ 위험 표시(conventionFindings 의 error)는 **정적 룰**만 근거로 한다 — LLM audit 은
 * warn 으로 강등돼 차단하지 않는다(2026-08-24, 오탐으로 정상 플러그인을 막던 문제).
 *
 * @see app/(workspace)/approvals/page.tsx
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, X, Loader2, Server, AlertTriangle } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";

interface DraftServer {
  id: string;
  name?: string;
  git_url?: string;
  status: string;
  manifest_meta?: {
    conventionFindings?: { severity: string; rule?: string; message?: string; source?: string }[];
    extensionName?: string;
  };
}

export function McpDrafts({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("approvals");
  const [drafts, setDrafts] = useState<DraftServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<{ data: DraftServer[] }>("/api/mcp/servers/drafts");
      setDrafts(res?.data ?? []);
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(id: string, action: "approve" | "reject") {
    setActing((p) => ({ ...p, [id]: true }));
    try {
      await ApiClient.post(`/api/mcp/servers/${id}/${action}`, {});
      await load();
      onRefreshAction?.();
    } catch (err) {
      alert(t("mcp.actionFailed", { error: err instanceof Error ? err.message : "" }));
    } finally {
      setActing((p) => ({ ...p, [id]: false }));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-10 text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (drafts.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">{t("mcp.empty")}</p>;
  }

  return (
    <div className="space-y-2">
      {drafts.map((d) => {
        // 정적 룰의 error 만 실제 차단 사유다 (LLM findings 는 warn 강등)
        const risky = d.manifest_meta?.conventionFindings?.some(
          (f) => f.severity === "error" && f.source !== "llm",
        );
        const busy = acting[d.id] ?? false;
        return (
          <Card key={d.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone="warn">{t("mcp.badge")}</Badge>
                  {d.manifest_meta?.extensionName && (
                    <Badge tone="neutral">{d.manifest_meta.extensionName}</Badge>
                  )}
                  {risky && (
                    <span className="inline-flex items-center gap-1 text-xs text-danger">
                      <AlertTriangle className="h-3.5 w-3.5" />{t("mcp.risk")}
                    </span>
                  )}
                </div>
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-fg">
                  <Server className="h-3.5 w-3.5 text-accent" />
                  {d.name ?? d.id.slice(0, 8)}
                </h3>
                {d.git_url && (
                  <p className="mt-1 truncate font-mono text-xs text-muted">{d.git_url}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" disabled={busy} onClick={() => void act(d.id, "approve")}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {t("approve")}
                </Button>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(d.id, "reject")}>
                  <X className="h-3.5 w-3.5" />{t("reject")}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
