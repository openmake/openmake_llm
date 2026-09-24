"use client";

/**
 * /knowledge 관리자 패널 — 가용성·차단 사유·활성 임베딩 인덱스·잡 수·재색인·프로파일 JSON 편집.
 * 관리자에게만 렌더된다(호출부에서 role 판정). 서버 계약은 확정 전이라 필드를 방어적으로 읽는다.
 */
import { useState } from "react";
import { Loader2, RefreshCw, Database, Check, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Card, Dialog } from "@/components/ui/primitives";
import { knowledgeApi, type KnowledgeProfile } from "../api";
import { qk } from "../constants";

function ProfileEditor({ profile }: { profile: KnowledgeProfile }) {
  const t = useTranslations("knowledge");
  const queryClient = useQueryClient();
  const [text, setText] = useState(() => JSON.stringify(profile.config ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("admin.invalidJson"));
      return;
    }
    // 프로필 config 는 JSON 객체여야 한다(배열·원시값 거절)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("admin.invalidJson"));
      return;
    }
    const config = parsed as Record<string, unknown>;
    setBusy(true);
    setError(null);
    try {
      await knowledgeApi.adminUpdateProfile(profile.id, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: qk.adminProfiles() });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("serverError"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-fg">
          {profile.name}
          <span className="ml-1.5 text-xs text-faint">{profile.kind}</span>
        </span>
        {profile.isDefault && <Badge tone="success">{t("admin.active")}</Badge>}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        className="w-full resize-y rounded border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-accent"
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
          {t("admin.saveProfile")}
        </Button>
      </div>
    </div>
  );
}

export function KnowledgeAdminPanel() {
  const t = useTranslations("knowledge");
  const [reindexOpen, setReindexOpen] = useState(false);
  const [reindexing, setReindexing] = useState(false);

  const { data: status } = useQuery({
    queryKey: qk.adminStatus(),
    queryFn: knowledgeApi.adminStatus,
    retry: false,
  });
  const { data: profiles = [] } = useQuery({
    queryKey: qk.adminProfiles(),
    queryFn: knowledgeApi.adminProfiles,
    retry: false,
  });

  const runReindex = async () => {
    setReindexing(true);
    try {
      await knowledgeApi.adminReindex();
    } finally {
      setReindexing(false);
      setReindexOpen(false);
    }
  };

  const cap = status?.capabilities;
  const jobEntries = Object.entries(status?.jobCounts ?? {});

  return (
    <Card className="border-accent/30 bg-accent-soft/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Database className="h-4 w-4 text-accent" />
          {t("admin.title")}
        </span>
        <Button size="sm" variant="outline" onClick={() => setReindexOpen(true)}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("admin.reindex")}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 text-xs">
          <p className="flex items-center gap-1.5">
            {cap?.ready ? (
              <Badge tone="success">{t("admin.ready")}</Badge>
            ) : (
              <Badge tone="warn">{t("admin.notReady")}</Badge>
            )}
          </p>
          {cap?.blockedReasons?.map((r) => (
            <p key={r} className="flex items-center gap-1 text-warn">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {r}
            </p>
          ))}
          {status?.embeddingIndex ? (
            <p className="text-muted">
              {t("admin.embeddingIndex")}:{" "}
              <span className="font-mono text-fg-2">
                {status.embeddingIndex.modelId} · {status.embeddingIndex.dimension}d
              </span>
            </p>
          ) : (
            cap?.embedding && (
              <p className="text-muted">
                {t("admin.embeddingIndex")}:{" "}
                <span className="font-mono text-fg-2">
                  {cap.embedding.modelId} · {cap.embedding.dimension}d
                </span>
              </p>
            )
          )}
        </div>
        <div className="space-y-1 text-xs">
          <p className="font-medium text-fg-2">{t("admin.jobs")}</p>
          {jobEntries.length === 0 ? (
            <p className="text-faint">{t("admin.noJobs")}</p>
          ) : (
            jobEntries.map(([k, v]) => (
              <p key={k} className="flex justify-between text-muted">
                <span>{k}</span>
                <span className="font-mono text-fg-2">{v}</span>
              </p>
            ))
          )}
        </div>
      </div>

      {profiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-fg-2">{t("admin.profiles")}</p>
          {profiles.map((p) => (
            <ProfileEditor key={p.id} profile={p} />
          ))}
        </div>
      )}

      <Dialog open={reindexOpen} onClose={() => setReindexOpen(false)} title={t("admin.reindexConfirmTitle")}>
        <p className="text-sm text-muted">{t("admin.reindexConfirmBody")}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setReindexOpen(false)} disabled={reindexing}>
            {t("cancel")}
          </Button>
          <Button variant="danger" onClick={() => void runReindex()} disabled={reindexing}>
            {reindexing && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("admin.reindex")}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
