"use client";

/**
 * /knowledge 관리자 패널 — 가용성·차단 사유·임베딩 색인 카탈로그(모델·차원·상태·공간 수)·잡 수·프로파일 JSON 편집.
 * 관리자에게만 렌더된다(호출부에서 role 판정). 서버 계약은 확정 전이라 필드를 방어적으로 읽는다.
 * 재색인은 관리자 전역 동작이 아니다 — 공간 쓰기 권한자가 프로젝트 상세에서 공간 단위로 한다(요청자 키로 실행).
 */
import { useState } from "react";
import { Loader2, Database, Check, AlertTriangle } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { knowledgeApi, type KnowledgeProfile } from "../api";
import { qk } from "../constants";
import { blockedReasonKey, indexStatusKey, splitBlockedReasons } from "../helpers";

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

  const cap = status?.capabilities;
  const jobEntries = Object.entries(status?.jobCounts ?? {});
  const indexes = status?.embeddingIndexes ?? [];
  const blocked = splitBlockedReasons(cap?.blockedReasons ?? []);
  const indexStatusLabel = (value: string): string => {
    const key = indexStatusKey(value);
    return key ? t(key) : value;
  };

  return (
    <Card className="border-accent/30 bg-accent-soft/20 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-fg">
          <Database className="h-4 w-4 text-accent" />
          {t("admin.title")}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 text-xs">
          {/* 배지는 플랫폼 사유만 본다 — 임베딩 사유는 요청한 관리자 개인의 설정·키 기준이라 따로 적는다 */}
          <p className="flex items-center gap-1.5">
            {cap && blocked.platform.length === 0 ? (
              <Badge tone="success">{t("admin.ready")}</Badge>
            ) : (
              <Badge tone="warn">{t("admin.notReady")}</Badge>
            )}
          </p>
          {blocked.platform.map((r) => {
            const key = blockedReasonKey(r);
            return (
              <p key={r} className="flex items-center gap-1 text-warn">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {key ? t(key) : r}
              </p>
            );
          })}
          {blocked.embedding.length > 0 && (
            <div className="space-y-0.5 pt-1">
              <p className="text-faint">{t("admin.embeddingByRequester")}</p>
              {blocked.embedding.map((r) => {
                const key = blockedReasonKey(r);
                return (
                  <p key={r} className="flex items-center gap-1 text-muted">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    {key ? t(key) : r}
                  </p>
                );
              })}
            </div>
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

      {/* 임베딩 색인 카탈로그 — 어느 모델·차원으로 몇 프로젝트가 색인돼 있는지(옛 색인은 retired 로 남는다) */}
      <div className="mt-4 space-y-1 text-xs">
        <p className="font-medium text-fg-2">{t("admin.embeddingIndex")}</p>
        {indexes.length === 0 ? (
          <p className="text-faint">{t("admin.noIndexes")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-faint">
                <tr>
                  <th className="py-1 pr-3 font-normal">{t("admin.indexModel")}</th>
                  <th className="py-1 pr-3 font-normal">{t("admin.indexDimension")}</th>
                  <th className="py-1 pr-3 font-normal">{t("admin.indexStatus")}</th>
                  <th className="py-1 font-normal">{t("admin.indexSpaces")}</th>
                </tr>
              </thead>
              <tbody>
                {indexes.map((i) => (
                  <tr key={i.id} className="border-t border-border text-muted">
                    <td className="break-all py-1 pr-3 font-mono text-fg-2">{i.providerRef}</td>
                    <td className="py-1 pr-3 font-mono">{i.dimension}</td>
                    <td className="py-1 pr-3">{indexStatusLabel(i.status)}</td>
                    <td className="py-1 font-mono">{i.spaceCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {profiles.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-fg-2">{t("admin.profiles")}</p>
          {profiles.map((p) => (
            <ProfileEditor key={p.id} profile={p} />
          ))}
        </div>
      )}
    </Card>
  );
}
