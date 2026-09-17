"use client";

/**
 * 웹훅 트리거 패널 (F16.5, 132) — 외부 시스템이 서명한 POST 로 템플릿 작업을 시작한다.
 *
 * 시크릿은 생성·재발급 응답에만 평문으로 온다 — 이 화면을 벗어나면 다시 볼 수 없다.
 * 서명 규칙(헤더·스킴·허용 창)은 서버 응답의 `signing` 을 그대로 보여 준다(클라이언트에 규칙 사본을 두지 않는다).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Webhook, Plus, Trash2, RotateCcw, Power, Copy } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import type { ApiSuccess } from "@openmake/shared-types";

interface ApiTrigger {
  id: string;
  name: string;
  template_id: string;
  enabled: boolean;
  approval_policy: "all" | "high-risk" | "none";
  fire_count: number;
  last_fired_at: string | null;
  consecutive_failures: number;
  last_error: string | null;
}
interface SigningGuide {
  endpoint: string;
  timestampHeader: string;
  signatureHeader: string;
  deliveryHeader: string;
  scheme: string;
  windowSec: number;
}
interface TemplateLite { id: string; name: string }

const POLICIES = ["all", "high-risk", "none"] as const;

export function TriggersPanel() {
  const t = useTranslations("agentTasks.triggers");
  const [triggers, setTriggers] = useState<ApiTrigger[]>([]);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [policy, setPolicy] = useState<(typeof POLICIES)[number]>("all");
  const [revealed, setRevealed] = useState<{ triggerId: string; secret: string; signing: SigningGuide } | null>(null);

  const load = useCallback(async () => {
    try {
      const [tr, tp] = await Promise.all([
        ApiClient.get<ApiSuccess<{ triggers: ApiTrigger[] }>>("/api/agent-task-triggers"),
        ApiClient.get<ApiSuccess<{ templates: TemplateLite[] }>>("/api/agent-task-templates"),
      ]);
      setTriggers(tr?.data?.triggers ?? []);
      setTemplates(tp?.data?.templates ?? []);
    } catch { /* 401·미배포: 빈 목록 */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try { await fn(); await load(); }
    catch (err) { alert(t("failed", { message: err instanceof Error ? err.message : "" })); }
    finally { setBusy(null); }
  }

  type SecretResponse = ApiSuccess<{ trigger: ApiTrigger; secret: string; signing: SigningGuide }>;
  const create = () => run("new", async () => {
    const r = await ApiClient.post<SecretResponse>("/api/agent-task-triggers", { name, templateId, approvalPolicy: policy });
    if (r?.data) setRevealed({ triggerId: r.data.trigger.id, secret: r.data.secret, signing: r.data.signing });
    setName(""); setTemplateId(""); setPolicy("all"); setOpen(false);
  });
  const rotate = (tr: ApiTrigger) => {
    if (!confirm(t("rotateConfirm"))) return;
    void run(tr.id, async () => {
      const r = await ApiClient.post<SecretResponse>(`/api/agent-task-triggers/${tr.id}/rotate-secret`, {});
      if (r?.data) setRevealed({ triggerId: tr.id, secret: r.data.secret, signing: r.data.signing });
    });
  };
  const toggle = (tr: ApiTrigger) => run(tr.id, () => ApiClient.patch(`/api/agent-task-triggers/${tr.id}`, { enabled: !tr.enabled }));
  const remove = (tr: ApiTrigger) => {
    if (!confirm(t("deleteConfirm"))) return;
    void run(tr.id, () => ApiClient.del(`/api/agent-task-triggers/${tr.id}`));
  };
  const templateName = (id: string) => templates.find((x) => x.id === id)?.name ?? t("templateMissing");
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };

  return (
    <Card className="mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-fg-2">
          <Webhook className="h-4 w-4 text-accent" /> {t("title")}
        </p>
        <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} disabled={templates.length === 0} title={templates.length === 0 ? t("needTemplate") : undefined}>
          <Plus className="h-3.5 w-3.5" /> {t("create")}
        </Button>
      </div>
      <p className="mb-3 text-xs text-muted">{t("hint", { placeholder: "{{payload}}" })}</p>

      {open && (
        <div className="mb-3 space-y-2 rounded-md border border-line bg-bg-1 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")}
            className="w-full rounded-md border border-line bg-bg-2 px-2 py-1.5 text-sm text-fg-1"
          />
          <div className="flex flex-wrap gap-2">
            <select aria-label={t("template")} value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-bg-2 px-2 text-xs text-fg-1">
              <option value="">{t("templatePick")}</option>
              {templates.map((tp) => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
            <select aria-label={t("policy")} value={policy} onChange={(e) => setPolicy(e.target.value as (typeof POLICIES)[number])}
              className="h-8 rounded-md border border-line bg-bg-2 px-2 text-xs text-fg-1">
              {POLICIES.map((p) => <option key={p} value={p}>{t(`policies.${p}`)}</option>)}
            </select>
            <Button size="sm" disabled={busy === "new" || !name.trim() || !templateId} onClick={create}>{t("add")}</Button>
          </div>
        </div>
      )}

      {revealed && (
        <div className="mb-3 space-y-1.5 rounded-md border border-warning-soft bg-warning-soft/40 p-3 text-xs">
          <p className="font-medium text-fg-1">{t("secretOnce")}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-bg-2 px-2 py-1 font-mono text-[11px] text-fg-1">{revealed.secret}</code>
            <Button size="sm" variant="outline" onClick={() => copy(revealed.secret)} title={t("copy")}><Copy className="h-3.5 w-3.5" /></Button>
          </div>
          <p className="break-all text-muted">POST {typeof window !== "undefined" ? window.location.origin : ""}{revealed.signing.endpoint}</p>
          <p className="break-all font-mono text-[11px] text-muted">
            {revealed.signing.timestampHeader}: &lt;epoch seconds&gt; · {revealed.signing.signatureHeader}: {revealed.signing.scheme}
          </p>
          <p className="text-muted">{t("signingNote", { window: revealed.signing.windowSec, delivery: revealed.signing.deliveryHeader })}</p>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>{t("dismiss")}</Button>
          </div>
        </div>
      )}

      {triggers.length === 0 ? (
        <p className="text-xs text-muted">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          {triggers.map((tr) => (
            <div key={tr.id} className="flex items-start justify-between gap-3 rounded-md border border-line bg-bg-1 p-2">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-fg-1">
                  <span className="truncate">{tr.name}</span>
                  <Badge tone={tr.enabled ? "success" : "neutral"}>{tr.enabled ? t("enabled") : t("disabled")}</Badge>
                  <Badge tone={tr.approval_policy === "none" ? "warn" : "neutral"}>{t(`policies.${tr.approval_policy}`)}</Badge>
                </p>
                <p className="mt-0.5 text-[11px] text-muted">
                  {templateName(tr.template_id)} · {t("fired", { count: tr.fire_count })}
                  {tr.last_fired_at && ` · ${new Date(tr.last_fired_at).toLocaleString()}`}
                </p>
                <p className="mt-0.5 break-all font-mono text-[10px] text-faint">/api/triggers/{tr.id}</p>
                {tr.consecutive_failures > 0 && (
                  <p className="mt-0.5 text-[11px] text-danger">{t("failures", { count: tr.consecutive_failures, error: tr.last_error ?? "" })}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button size="sm" variant="outline" disabled={busy === tr.id} onClick={() => toggle(tr)} title={tr.enabled ? t("disable") : t("enable")}>
                  <Power className={`h-3.5 w-3.5 ${tr.enabled ? "text-accent" : ""}`} />
                </Button>
                <Button size="sm" variant="outline" disabled={busy === tr.id} onClick={() => rotate(tr)} title={t("rotate")}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" disabled={busy === tr.id} onClick={() => remove(tr)} title={t("delete")}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
