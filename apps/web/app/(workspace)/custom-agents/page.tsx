"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bot, Plus, Pencil, Trash2, GitBranch, X, Loader2, Check, MessageSquare } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";
import { fetchModels, type ModelEntry } from "@/lib/models-api";
import { useAppStore } from "@/lib/store";

/* ── 타입 ────────────────────────────────────────────────── */
interface CustomAgent {
  id: string;
  emoji: string;
  name: string;
  description: string;
  systemPrompt: string;
  /** 에이전트 전용 모델 fullId (null=상속) */
  model: string | null;
  source: "git" | "custom";
}

interface ApiUserAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  icon: string | null;
  model: string | null;
}

type UserAgentsResponse = ApiSuccess<{ agents: ApiUserAgent[] }>;

interface ApiCustomAgentDraft {
  id: string;
  name: string;
  description: string | null;
  system_prompt?: string;
  status?: string;
}

type DraftAgentsResponse = ApiSuccess<{ drafts: ApiCustomAgentDraft[]; total: number }>;

function mapAgent(a: ApiUserAgent): CustomAgent {
  return {
    id: a.id,
    emoji: a.icon || "🤖",
    name: a.name,
    description: a.description || "",
    systemPrompt: a.system_prompt,
    model: a.model ?? null,
    source: "custom",
  };
}

/* ── 목업 폴백 ─────────────────────────────────────────────── */
const AGENTS_FALLBACK_META: {
  id: string; emoji: string; nameKey: string; descKey: string; promptKey: string; source: "git" | "custom";
}[] = [
  {
    id: "a1", emoji: "📐",
    nameKey: "fallback.techWriter.name",
    descKey: "fallback.techWriter.description",
    promptKey: "fallback.techWriter.systemPrompt", source: "custom",
  },
  {
    id: "a2", emoji: "🧪",
    nameKey: "fallback.reviewer.name",
    descKey: "fallback.reviewer.description",
    promptKey: "fallback.reviewer.systemPrompt", source: "git",
  },
];

const TAB_ACTIVE = "active";
const TAB_DRAFT = "draft";

/* ── 오버레이 모달 ────────────────────────────────────────── */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto mx-4 rounded-lg border border-border bg-app shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ── 에이전트 생성/편집 폼 ────────────────────────────────── */
function AgentForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: CustomAgent;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("customAgents");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [icon, setIcon] = useState(initial?.emoji ?? "🤖");
  const [model, setModel] = useState(initial?.model ?? "");
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = !!initial;

  useEffect(() => {
    void fetchModels({ forRoleAssignment: true }).then((p) => setModels(p.models)).catch(() => setModels([]));
  }, []);

  async function handleSubmit() {
    if (!name.trim()) { setFormError(t("nameRequired")); return; }
    if (!systemPrompt.trim()) { setFormError(t("systemPromptRequired")); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (isEdit) {
        await ApiClient.put(`/api/users/me/agents/${initial.id}`, {
          name: name.trim(),
          description: description.trim() || null,
          systemPrompt: systemPrompt.trim(),
          icon: icon.trim() || null,
          model: model || null,
        });
      } else {
        await ApiClient.post("/api/users/me/agents", {
          name: name.trim(),
          description: description.trim() || null,
          systemPrompt: systemPrompt.trim(),
          icon: icon.trim() || null,
          model: model || null,
        });
      }
      await onSaved();
    } catch (err) {
      setFormError(t("saveFailed", { error: err instanceof Error ? err.message : t("serverError") }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("iconLabel")}</span>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4}
            className="h-9 w-16 rounded-md border border-border bg-surface px-2 text-center text-lg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("nameLabel")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("namePlaceholder")} autoFocus
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("descriptionLabel")}</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t("descriptionPlaceholder")}
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("modelLabel")}</span>
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm text-fg outline-none focus:border-accent">
          <option value="">{t("modelInherit")}</option>
          {models.map((m) => (
            <option key={m.modelId} value={m.modelId}>
              {m.name}{m.provider !== "local-llm" ? ` (${m.provider})` : ""}
            </option>
          ))}
        </select>
        <span className="text-xs text-faint">{t("modelHelp")}</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("systemPromptLabel")}</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder={t("systemPromptPlaceholder")}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
        <span className="text-xs text-faint">{systemPrompt.length}/8000</span>
      </label>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{t("cancel")}</Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEdit ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}

/* ── Git Ingest 폼 (Agent용) ──────────────────────────────── */
function AgentGitIngestForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("customAgents");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitPath, setGitPath] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleImport() {
    if (!gitUrl.trim()) { setFormError(t("gitUrlRequired")); return; }
    setLoading(true);
    setFormError(null);
    setProgress(t("fetchingRepo"));

    try {
      const resp = await fetch("/api/agents/custom/import-from-git", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        credentials: "include",
        body: JSON.stringify({
          gitUrl: gitUrl.trim(),
          gitRef: gitRef.trim() || undefined,
          gitPath: gitPath.trim() || undefined,
          accessToken: accessToken.trim() || undefined,
        }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => t("serverError"));
        setFormError(t("importFailedStatus", { status: resp.status, error: errText }));
        setLoading(false);
        setProgress(null);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const eventLine = part.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const eventName = eventLine ? eventLine.replace("event:", "").trim() : "message";
          const data = dataLine.replace("data:", "").trim();

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (eventName === "progress") {
              setProgress(t("processingManifest"));
            } else if (eventName === "result") {
              setProgress(t("done"));
              setLoading(false);
              await onSaved();
              return;
            } else if (eventName === "error") {
              const errMsg = ((parsed as { error?: { message?: string } }).error?.message) || t("importFailed");
              setFormError(errMsg);
              setLoading(false);
              setProgress(null);
              return;
            }
          } catch {
            // 무시
          }
        }
      }
      await onSaved();
    } catch (err) {
      setFormError(t("requestFailed", { error: err instanceof Error ? err.message : t("networkError") }));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleImport(); }} className="space-y-4">
      <p className="text-sm text-muted">{t("gitIngestDescription")}</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("gitUrlLabel")}</span>
        <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} autoFocus
          placeholder="https://github.com/owner/repo"
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("branchTagLabel")}</span>
          <input value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("filePathLabel")}</span>
          <input value={gitPath} onChange={(e) => setGitPath(e.target.value)} placeholder="AGENT.md"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("accessTokenLabel")}</span>
        <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} placeholder="ghp_..."
          className="h-9 w-full rounded-md border border-border bg-surface px-3 font-mono text-sm text-fg outline-none focus:border-accent" />
      </label>
      {progress && (
        <div className="flex items-center gap-2 text-xs text-accent">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progress}
        </div>
      )}
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>{t("cancel")}</Button>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          {t("importButton")}
        </Button>
      </div>
    </form>
  );
}

/* ── Draft 탭 (에이전트용) ──────────────────────────────────── */
function AgentDraftTab({ onRefresh }: { onRefresh: () => void }) {
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
      onRefresh();
    } catch (err) {
      alert(t("approveFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function handleReject(agentId: string) {
    if (!window.confirm(t("rejectConfirm"))) return;
    try {
      await ApiClient.post(`/api/agents/custom/${agentId}/reject`, {});
      await loadDrafts();
    } catch (err) {
      alert(t("rejectFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <Loader2 className="mb-3 h-6 w-6 animate-spin text-faint" />
        <p className="text-sm text-muted">{t("loadingDrafts")}</p>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <Bot className="mb-3 h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-fg-2">{t("noDraftsTitle")}</p>
        <p className="mt-1 text-sm text-muted">{t("noDraftsDescription")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <Card key={d.id} className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone="warn">Draft</Badge>
              </div>
              <h3 className="text-sm font-semibold text-fg">{d.name}</h3>
              {d.description && (
                <p className="mt-1 text-xs text-muted line-clamp-2">{d.description}</p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
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

/* ── 메인 페이지 ──────────────────────────────────────────── */
export default function CustomAgentsPage() {
  const t = useTranslations("customAgents");
  const [agents, setAgents] = useState<CustomAgent[]>(() =>
    AGENTS_FALLBACK_META.map((m) => ({
      id: m.id,
      emoji: m.emoji,
      name: t(m.nameKey),
      description: t(m.descKey),
      systemPrompt: t(m.promptKey),
      model: null,
      source: m.source,
    })),
  );
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>(TAB_ACTIVE);
  const [showCreate, setShowCreate] = useState(false);
  const [showGitIngest, setShowGitIngest] = useState(false);
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null);
  const router = useRouter();
  const activeUserAgent = useAppStore((s) => s.activeUserAgent);
  const setActiveUserAgent = useAppStore((s) => s.setActiveUserAgent);

  function selectAgentForChat(agent: CustomAgent) {
    setActiveUserAgent({ id: agent.id, name: agent.name, icon: agent.emoji });
    router.push("/");
  }

  const loadAgents = useCallback(async () => {
    try {
      const res = await ApiClient.get<UserAgentsResponse>("/api/users/me/agents");
      setAgents((res?.data?.agents ?? []).map(mapAgent));
    } catch {
      // 401·네트워크 실패: 목업 폴백 유지
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadAgents();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadAgents]);

  async function handleDelete(agent: CustomAgent) {
    if (!window.confirm(t("deleteConfirm", { name: agent.name }))) return;
    try {
      await ApiClient.del(`/api/users/me/agents/${agent.id}`);
      if (activeUserAgent?.id === agent.id) setActiveUserAgent(null);
      await loadAgents();
    } catch (err) {
      alert(t("deleteFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function afterSave() {
    setShowCreate(false);
    setShowGitIngest(false);
    setEditingAgent(null);
    await loadAgents();
  }

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowGitIngest(true)}>
              <GitBranch className="h-4 w-4" />
              {t("importFromGit")}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />{t("newAgent")}
            </Button>
          </>
        }
      />

      {/* 탭 */}
      <div className="flex gap-4 border-b border-border px-6 pt-3">
        {[{ id: TAB_ACTIVE, labelKey: "tabActive" }, { id: TAB_DRAFT, labelKey: "tabDraft" }].map((tabItem) => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id)}
            className={`pb-2 text-sm font-medium transition border-b-2 ${tab === tabItem.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
            {t(tabItem.labelKey)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === TAB_DRAFT ? (
          <AgentDraftTab onRefresh={loadAgents} />
        ) : loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Bot className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">{t("loading")}</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Bot className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">{t("emptyTitle")}</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              {t("emptyDescription")}
            </p>
            <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />{t("createNewAgent")}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {agents.map((agent) => (
              <Card key={agent.id} className="flex flex-col p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div className="grid h-10 w-10 place-items-center rounded-md bg-accent-soft text-xl">
                    {agent.emoji}
                  </div>
                  {agent.source === "git" && (
                    <Badge tone="neutral">
                      <GitBranch className="h-3 w-3" />
                      git
                    </Badge>
                  )}
                </div>

                <h3 className="mb-1 text-sm font-semibold text-fg">{agent.name}</h3>
                <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-muted">
                  {agent.description || t("noDescription")}
                </p>

                <div className="mb-4 flex-1 rounded-md border border-border bg-surface-2 p-3">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-faint">
                    {t("systemPromptHeading")}
                  </p>
                  <p className="line-clamp-3 text-xs leading-relaxed text-fg-2">
                    {agent.systemPrompt}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  {activeUserAgent?.id === agent.id ? (
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setActiveUserAgent(null)}>
                      <Check className="h-3.5 w-3.5 text-accent" />
                      {t("inUseDeselect")}
                    </Button>
                  ) : (
                    <Button size="sm" className="w-full" onClick={() => selectAgentForChat(agent)}>
                      <MessageSquare className="h-3.5 w-3.5" />
                      {t("useInChat")}
                    </Button>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingAgent(agent)}>
                      <Pencil className="h-3.5 w-3.5" />
                      {t("edit")}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={t("deleteAria")} onClick={() => void handleDelete(agent)}>
                      <Trash2 className="h-4 w-4 text-danger" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 모달들 */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("createModalTitle")}>
        <AgentForm onClose={() => setShowCreate(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={!!editingAgent} onClose={() => setEditingAgent(null)} title={t("editModalTitle")}>
        {editingAgent && (
          <AgentForm initial={editingAgent} onClose={() => setEditingAgent(null)} onSaved={afterSave} />
        )}
      </Modal>

      <Modal open={showGitIngest} onClose={() => setShowGitIngest(false)} title={t("gitImportModalTitle")}>
        <AgentGitIngestForm onClose={() => setShowGitIngest(false)} onSaved={afterSave} />
      </Modal>
    </>
  );
}
