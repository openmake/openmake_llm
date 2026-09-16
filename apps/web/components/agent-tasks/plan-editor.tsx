"use client";

/**
 * 계획 편집기 (F18 PR-4, 139) — 단계 텍스트·완료 기준 편집, 추가·삭제·이동. 저장은 PUT /api/agent-tasks/:id/plan
 * (expectedVersion 낙관적 잠금 — 409 면 "다른 곳에서 바뀜" 안내 후 다시 불러오기). 실행 중이면 다음 턴부터 적용된다.
 */
import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Plus, Trash2, Save, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { ApiClient, ApiError } from "@/lib/api-client";

interface Step { text: string; doneWhen?: string; status?: string }

export function PlanEditor({ taskId, plan, planVersion, running, onSaved, onCancel }: {
  taskId: string; plan: Step[]; planVersion: number; running: boolean; onSaved: () => void; onCancel: () => void;
}) {
  const t = useTranslations("agentTasks.planEdit");
  const [steps, setSteps] = useState<Step[]>(plan.map((s) => ({ text: s.text, doneWhen: s.doneWhen, status: s.status })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputCls = "w-full rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent";

  const update = (i: number, patch: Partial<Step>) => setSteps((p) => p.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) => setSteps((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function save() {
    setBusy(true); setError(null);
    try {
      await ApiClient.put(`/api/agent-tasks/${taskId}/plan`, {
        steps: steps.filter((s) => s.text.trim()).map((s) => (s.doneWhen ? { text: s.text.trim(), doneWhen: s.doneWhen } : s.text.trim())),
        expectedVersion: planVersion,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? t("conflict") : e instanceof Error ? e.message : t("failed"));
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-md border border-border bg-surface-1 p-3">
      <p className="mb-2 text-xs font-medium text-fg-2">{t("title")}{running ? ` · ${t("nextTurn")}` : ""}</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-1 w-4 text-[11px] text-muted">{i + 1}.</span>
            <div className="min-w-0 flex-1 space-y-1">
              <input className={inputCls} value={s.text} onChange={(e) => update(i, { text: e.target.value })} placeholder={t("stepPlaceholder")} aria-label={t("stepPlaceholder")} />
              <input className={inputCls} value={s.doneWhen ?? ""} onChange={(e) => update(i, { doneWhen: e.target.value || undefined })} placeholder={t("doneWhenPlaceholder")} aria-label={t("doneWhenPlaceholder")} />
            </div>
            <div className="flex shrink-0 flex-col gap-0.5">
              <button type="button" className="rounded p-0.5 text-muted hover:bg-surface-2" aria-label={t("moveUp")} onClick={() => move(i, -1)}><ArrowUp className="h-3 w-3" /></button>
              <button type="button" className="rounded p-0.5 text-muted hover:bg-surface-2" aria-label={t("moveDown")} onClick={() => move(i, 1)}><ArrowDown className="h-3 w-3" /></button>
              <button type="button" className="rounded p-0.5 text-danger hover:bg-surface-2" aria-label={t("remove")} onClick={() => setSteps((p) => p.filter((_, k) => k !== i))}><Trash2 className="h-3 w-3" /></button>
            </div>
          </li>
        ))}
      </ol>
      {error && <p className="mt-2 text-xs text-danger" role="alert">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setSteps((p) => [...p, { text: "" }])}><Plus className="h-3.5 w-3.5" /> {t("add")}</Button>
        <Button size="sm" disabled={busy || steps.every((s) => !s.text.trim())} onClick={() => void save()}><Save className="h-3.5 w-3.5" /> {t("save")}</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}><X className="h-3.5 w-3.5" /> {t("cancel")}</Button>
      </div>
    </div>
  );
}
