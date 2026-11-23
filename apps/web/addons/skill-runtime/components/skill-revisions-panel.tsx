"use client";

/**
 * 스킬 이전 버전 — 수정할 때마다 직전 내용이 남는다(apps/api skill_revisions, 203).
 * 복원하면 그 내용으로 다시 저장되고, 지금 내용도 이력에 남아 복원을 되돌릴 수 있다.
 * 볼 권한이 없으면(남의 스킬·시스템 스킬) 패널을 그리지 않는다.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { History, Loader2, RotateCcw } from "lucide-react";
import type { ApiSuccess } from "@openmake/shared-types";
import { Button } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";

interface SkillRevision {
  id: string;
  name: string;
  description: string | null;
  content: string;
  category: string | null;
  createdAt: string;
}

const PREVIEW_CHARS = 1200;

export function SkillRevisionsPanel({ skillId, onRestored }: { skillId: string; onRestored: () => void | Promise<void> }) {
  const t = useTranslations("skillLibrary.revisions");
  const [revisions, setRevisions] = useState<SkillRevision[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ApiClient.get<ApiSuccess<{ revisions: SkillRevision[] }>>(`/api/agents/skills/${encodeURIComponent(skillId)}/revisions`)
      .then((res) => { if (!cancelled) setRevisions(res?.data?.revisions ?? []); })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setHidden(true);
        else setLoadError(true);
      });
    return () => { cancelled = true; };
  }, [skillId]);

  async function restore(rev: SkillRevision) {
    if (!window.confirm(t("confirmRestore", { date: formatDate(rev.createdAt) }))) return;
    setRestoringId(rev.id);
    setRestoreError(null);
    try {
      await ApiClient.post(`/api/agents/skills/${encodeURIComponent(skillId)}/revisions/${rev.id}/restore`, {});
      await onRestored();
    } catch (e) {
      setRestoreError(t("restoreFailed", { error: e instanceof Error ? e.message : "" }));
    } finally {
      setRestoringId(null);
    }
  }

  if (hidden) return null;

  return (
    <section data-testid="skill-revisions" className="mt-5 border-t border-border pt-4">
      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-fg-2">
        <History className="h-3.5 w-3.5" />
        {t("title")}
      </h4>
      {loadError ? (
        <p className="text-xs text-danger">{t("loadFailed")}</p>
      ) : revisions === null ? (
        <p className="text-xs text-muted"><Loader2 className="inline h-3 w-3 animate-spin" /> {t("loading")}</p>
      ) : revisions.length === 0 ? (
        <p className="text-xs text-muted">{t("empty")}</p>
      ) : (
        <ul className="max-h-64 space-y-1.5 overflow-y-auto">
          {revisions.map((rev) => (
            <li key={rev.id} data-testid="skill-revision" className="rounded-md border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpenId(openId === rev.id ? null : rev.id)}>
                  <span className="block truncate text-xs font-medium text-fg">{rev.name}</span>
                  <span className="block text-[11px] text-muted">{t("savedAt", { date: formatDate(rev.createdAt) })}</span>
                </button>
                <Button type="button" variant="outline" size="sm" disabled={restoringId !== null} onClick={() => void restore(rev)}>
                  {restoringId === rev.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  {t("restore")}
                </Button>
              </div>
              {openId === rev.id && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-2 p-2 text-[11px] text-fg-2">
                  {rev.content.length > PREVIEW_CHARS ? `${rev.content.slice(0, PREVIEW_CHARS)}…` : rev.content}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
      {restoreError && <p className="mt-2 text-xs text-danger">{restoreError}</p>}
      <p className="mt-2 text-[11px] text-muted">{t("note")}</p>
    </section>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
