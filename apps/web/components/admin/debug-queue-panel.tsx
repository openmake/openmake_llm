"use client";

/**
 * 디버그 큐(오류 자동 저장·사용자 신고) 관리자 패널 — F24.7 재현 번들 UI.
 * 백엔드 `GET /api/debug-queue`·`/:id/replay-bundle`·`POST /:id/replay`. 리플레이는 실제 LLM 을 호출해 비용이 들고
 * 분당 3회로 제한되므로 확인 대화상자를 거친다. 번들에는 마스킹된 마지막 LLM 요청이 들어 있다.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bug, Download, Loader2, Play, RefreshCw } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Table, Td, Th } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";
import { triggerBlobDownload } from "@/lib/artifact-download";
import { toBcp47 } from "@/i18n/config";

interface DebugItem {
  id: string; sessionId: string; userId: string; reason: "auto-error" | "user-report"; errorCode: string | null;
  capturedAt: string; expiresAt: string; hasReplayBundle: boolean; replayTruncated: boolean;
  userPreview: string; assistantPreview: string;
}
interface ReplayResult { model: string; content: string; durationMs: number; similarity: number | null; toolCalls: string[] }

export function DebugQueuePanel() {
  const t = useTranslations("adminConversations.debugQueue");
  const locale = toBcp47(useLocale());
  const [items, setItems] = useState<DebugItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<DebugItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [result, setResult] = useState<{ item: DebugItem; replay: ReplayResult } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await ApiClient.get<ApiSuccess<{ items: DebugItem[] }>>("/api/debug-queue?limit=50");
      setItems(r.data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("loadError"));
    }
  }, [t]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  async function downloadBundle(item: DebugItem) {
    setBusyId(item.id);
    try {
      const r = await ApiClient.get<ApiSuccess<unknown>>(`/api/debug-queue/${item.id}/replay-bundle`);
      triggerBlobDownload(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }), `replay-bundle-${item.id}.json`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("actionError"));
    } finally {
      setBusyId(null);
    }
  }

  async function replay(item: DebugItem) {
    setConfirm(null);
    setBusyId(item.id);
    setError(null);
    try {
      const r = await ApiClient.post<ApiSuccess<ReplayResult>>(`/api/debug-queue/${item.id}/replay`, {});
      setResult({ item, replay: r.data });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? t("rateLimited") : e instanceof Error ? e.message : t("actionError"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-4 w-4" aria-hidden />
          {t("title")}
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => void load()} aria-label={t("refresh")}>
          <RefreshCw className="h-4 w-4" aria-hidden />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted">{t("description")}</p>
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
        {items === null ? (
          <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin text-faint" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">{t("empty")}</p>
        ) : (
          <Table>
            <thead>
              <tr><Th>{t("col.captured")}</Th><Th>{t("col.reason")}</Th><Th>{t("col.messages")}</Th><Th>{t("col.actions")}</Th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <Td className="whitespace-nowrap text-xs">
                    {new Date(it.capturedAt).toLocaleString(locale)}
                    <span className="block font-mono text-[11px] text-muted">user {it.userId}</span>
                  </Td>
                  <Td>
                    <Badge tone={it.reason === "auto-error" ? "danger" : "warn"}>{t(`reason.${it.reason === "auto-error" ? "autoError" : "userReport"}`)}</Badge>
                    {it.errorCode && <span className="mt-1 block font-mono text-[11px] text-muted">{it.errorCode}</span>}
                  </Td>
                  <Td className="max-w-md text-xs">
                    <span className="block truncate text-fg-2">Q: {it.userPreview}</span>
                    <span className="block truncate text-muted">A: {it.assistantPreview || "—"}</span>
                  </Td>
                  <Td>
                    {it.hasReplayBundle ? (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => void downloadBundle(it)} disabled={busyId === it.id}
                          aria-label={t("downloadBundle")} title={t("downloadBundle")}>
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirm(it)} disabled={busyId === it.id}
                          aria-label={t("replay")} title={t("replay")}>
                          {busyId === it.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                        {it.replayTruncated && <Badge tone="neutral">{t("truncated")}</Badge>}
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted">{t("noBundle")}</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!confirm} onClose={() => setConfirm(null)} title={t("confirmTitle")}>
        <p className="text-sm text-fg-2">{t("confirmBody")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setConfirm(null)}>{t("cancel")}</Button>
          <Button size="sm" onClick={() => confirm && void replay(confirm)}>{t("replay")}</Button>
        </div>
      </Dialog>

      <Dialog open={!!result} onClose={() => setResult(null)} title={t("resultTitle")} className="max-w-2xl">
        {result && (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted">
              {t("resultMeta", {
                model: result.replay.model,
                seconds: (result.replay.durationMs / 1000).toFixed(1),
                similarity: result.replay.similarity === null ? "—" : result.replay.similarity.toFixed(3),
              })}
            </p>
            {result.replay.toolCalls.length > 0 && (
              <p className="font-mono text-xs text-fg-2">{t("toolCalls")}: {result.replay.toolCalls.join(", ")}</p>
            )}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-xs text-fg">{result.replay.content || "—"}</pre>
            <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setResult(null)}>{t("close")}</Button></div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
