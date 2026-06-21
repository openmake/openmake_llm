"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Plus, Pencil, Trash2, GitBranch, X, Loader2, Check } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 타입 ────────────────────────────────────────────────── */
interface CustomAgent {
  id: string;
  emoji: string;
  name: string;
  description: string;
  systemPrompt: string;
  source: "git" | "custom";
}

interface ApiUserAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  icon: string | null;
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
    description: a.description || "설명이 없습니다.",
    systemPrompt: a.system_prompt,
    source: "custom",
  };
}

/* ── 목업 폴백 ─────────────────────────────────────────────── */
const AGENTS_FALLBACK: CustomAgent[] = [
  {
    id: "a1", emoji: "📐", name: "기술 문서 작성가",
    description: "API 레퍼런스와 아키텍처 문서를 일관된 톤으로 작성합니다.",
    systemPrompt: "당신은 시니어 테크니컬 라이터입니다...", source: "custom",
  },
  {
    id: "a2", emoji: "🧪", name: "코드 리뷰어",
    description: "변경된 코드의 버그와 단순화 기회를 집어냅니다.",
    systemPrompt: "당신은 까다로운 코드 리뷰어입니다...", source: "git",
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
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description === "설명이 없습니다." ? "" : (initial?.description ?? ""));
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [icon, setIcon] = useState(initial?.emoji ?? "🤖");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = !!initial;

  async function handleSubmit() {
    if (!name.trim()) { setFormError("에이전트 이름을 입력하세요."); return; }
    if (!systemPrompt.trim()) { setFormError("시스템 프롬프트를 입력하세요."); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (isEdit) {
        await ApiClient.put(`/api/users/me/agents/${initial.id}`, {
          name: name.trim(),
          description: description.trim() || null,
          systemPrompt: systemPrompt.trim(),
          icon: icon.trim() || null,
        });
      } else {
        await ApiClient.post("/api/users/me/agents", {
          name: name.trim(),
          description: description.trim() || null,
          systemPrompt: systemPrompt.trim(),
          icon: icon.trim() || null,
        });
      }
      await onSaved();
    } catch (err) {
      setFormError("저장 실패: " + (err instanceof Error ? err.message : "서버 오류"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">아이콘</span>
          <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4}
            className="h-9 w-16 rounded-md border border-border bg-surface px-2 text-center text-lg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">에이전트 이름 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="예: 기술 문서 작성가" autoFocus
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">설명</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="이 에이전트가 하는 일을 간단히 설명하세요"
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">시스템 프롬프트 *</span>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
          rows={6}
          placeholder="당신은 ... 전문가입니다. ..."
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
        <span className="text-xs text-faint">{systemPrompt.length}/8000</span>
      </label>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>취소</Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEdit ? "저장" : "생성"}
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
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitPath, setGitPath] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleImport() {
    if (!gitUrl.trim()) { setFormError("GitHub URL을 입력하세요."); return; }
    setLoading(true);
    setFormError(null);
    setProgress("저장소 가져오는 중...");

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
        const errText = await resp.text().catch(() => "서버 오류");
        setFormError(`실패 (${resp.status}): ${errText}`);
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
              setProgress("매니페스트 처리 중...");
            } else if (eventName === "result") {
              setProgress("완료!");
              setLoading(false);
              await onSaved();
              return;
            } else if (eventName === "error") {
              const errMsg = ((parsed as { error?: { message?: string } }).error?.message) || "가져오기 실패";
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
      setFormError("요청 실패: " + (err instanceof Error ? err.message : "네트워크 오류"));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleImport(); }} className="space-y-4">
      <p className="text-sm text-muted">GitHub 저장소의 AGENT.md 매니페스트를 가져와 draft로 저장합니다.</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">GitHub URL *</span>
        <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} autoFocus
          placeholder="https://github.com/owner/repo"
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">브랜치/태그 (선택)</span>
          <input value={gitRef} onChange={(e) => setGitRef(e.target.value)} placeholder="main"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">파일 경로 (선택)</span>
          <input value={gitPath} onChange={(e) => setGitPath(e.target.value)} placeholder="AGENT.md"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">Access Token (비공개 저장소)</span>
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
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>취소</Button>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          가져오기
        </Button>
      </div>
    </form>
  );
}

/* ── Draft 탭 (에이전트용) ──────────────────────────────────── */
function AgentDraftTab({ onRefresh }: { onRefresh: () => void }) {
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
      alert("승인 실패: " + (err instanceof Error ? err.message : "오류"));
    }
  }

  async function handleReject(agentId: string) {
    if (!window.confirm("이 draft 에이전트를 거부(보관)하시겠습니까?")) return;
    try {
      await ApiClient.post(`/api/agents/custom/${agentId}/reject`, {});
      await loadDrafts();
    } catch (err) {
      alert("거부 실패: " + (err instanceof Error ? err.message : "오류"));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <Loader2 className="mb-3 h-6 w-6 animate-spin text-faint" />
        <p className="text-sm text-muted">Draft 불러오는 중...</p>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <Bot className="mb-3 h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-fg-2">승인 대기 중인 Draft가 없습니다</p>
        <p className="mt-1 text-sm text-muted">Git URL 가져오기로 생성된 에이전트가 여기 나타납니다.</p>
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
                <Check className="h-3.5 w-3.5" />승인
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleReject(d.id)}>
                <X className="h-3.5 w-3.5" />거부
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
  const [agents, setAgents] = useState<CustomAgent[]>(AGENTS_FALLBACK);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>(TAB_ACTIVE);
  const [showCreate, setShowCreate] = useState(false);
  const [showGitIngest, setShowGitIngest] = useState(false);
  const [editingAgent, setEditingAgent] = useState<CustomAgent | null>(null);

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
    if (!window.confirm(`"${agent.name}" 에이전트를 삭제하시겠습니까?`)) return;
    try {
      await ApiClient.del(`/api/users/me/agents/${agent.id}`);
      await loadAgents();
    } catch (err) {
      alert("삭제 실패: " + (err instanceof Error ? err.message : "오류"));
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
        title="커스텀 에이전트"
        description="나만의 시스템 프롬프트로 특화된 에이전트를 정의합니다."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowGitIngest(true)}>
              <GitBranch className="h-4 w-4" />
              Git URL 에서 가져오기
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />새 에이전트
            </Button>
          </>
        }
      />

      {/* 탭 */}
      <div className="flex gap-4 border-b border-border px-6 pt-3">
        {[{ id: TAB_ACTIVE, label: "활성 에이전트" }, { id: TAB_DRAFT, label: "Draft 검토" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`pb-2 text-sm font-medium transition border-b-2 ${tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === TAB_DRAFT ? (
          <AgentDraftTab onRefresh={loadAgents} />
        ) : loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Bot className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Bot className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">아직 커스텀 에이전트가 없습니다</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              직접 만들거나 Git URL 에서 가져와 특화된 에이전트를 추가하세요.
            </p>
            <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />새 에이전트 만들기
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
                  {agent.description}
                </p>

                <div className="mb-4 flex-1 rounded-md border border-border bg-surface-2 p-3">
                  <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-faint">
                    시스템 프롬프트
                  </p>
                  <p className="line-clamp-3 text-xs leading-relaxed text-fg-2">
                    {agent.systemPrompt}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditingAgent(agent)}>
                    <Pencil className="h-3.5 w-3.5" />
                    편집
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="삭제" onClick={() => void handleDelete(agent)}>
                    <Trash2 className="h-4 w-4 text-danger" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* 모달들 */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="새 에이전트 생성">
        <AgentForm onClose={() => setShowCreate(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={!!editingAgent} onClose={() => setEditingAgent(null)} title="에이전트 편집">
        {editingAgent && (
          <AgentForm initial={editingAgent} onClose={() => setEditingAgent(null)} onSaved={afterSave} />
        )}
      </Modal>

      <Modal open={showGitIngest} onClose={() => setShowGitIngest(false)} title="Git URL에서 에이전트 가져오기">
        <AgentGitIngestForm onClose={() => setShowGitIngest(false)} onSaved={afterSave} />
      </Modal>
    </>
  );
}
