"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Library,
  Plus,
  Package,
  Upload,
  Pencil,
  Trash2,
  X,
  Star,
  GitBranch,
  Cpu,
  Loader2,
  Check,
  Download,
} from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 카테고리 라벨 (id → i18n 키) ──────────────────────────── */
const CATEGORY_KEYS: Record<string, string> = {
  productivity: "categories.productivity",
  technology: "categories.technology",
  creative: "categories.creative",
  business: "categories.business",
  science: "categories.science",
  communication: "categories.communication",
  finance: "categories.finance",
  education: "categories.education",
};

/* ── 타입 ─────────────────────────────────────────────────── */
interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  isSystem: boolean;
  status?: string;
  content?: string;
  createdBy?: string | null;
}

interface ApiSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  status?: string;
  content?: string;
  createdBy?: string | null;
}

type SkillsResponse = ApiSuccess<{
  skills: ApiSkill[];
  total: number;
  limit: number;
  offset: number;
}>;

type DraftsResponse = ApiSuccess<{
  drafts: ApiSkill[];
  total: number;
}>;

/* ── 목업 폴백 ─────────────────────────────────────────────── */
type Translate = (key: string) => string;

function buildFallback(t: Translate): Skill[] {
  return [
    { id: "s1", name: t("fallback.pdfSummary.name"), category: "productivity", description: t("fallback.pdfSummary.description"), isSystem: true },
    { id: "s2", name: t("fallback.sqlQuery.name"), category: "technology", description: t("fallback.sqlQuery.description"), isSystem: true },
    { id: "s3", name: t("fallback.adCopy.name"), category: "creative", description: t("fallback.adCopy.description"), isSystem: false },
    { id: "s4", name: t("fallback.financialReport.name"), category: "finance", description: t("fallback.financialReport.description"), isSystem: false },
  ];
}

function mapSkill(s: ApiSkill): Skill {
  return {
    id: s.id,
    name: s.name,
    category: s.category || "general",
    description: s.description || "",
    isSystem: !s.createdBy,
    status: s.status,
    content: s.content,
    createdBy: s.createdBy,
  };
}

function categoryLabel(t: Translate, id: string): string {
  const key = CATEGORY_KEYS[id];
  if (key) return t(key);
  return id || t("categoryGeneral");
}

const ALL = "all";
const TAB_ACTIVE = "active";
const TAB_DRAFT = "draft";

/* ── 오버레이 모달 컴포넌트 ──────────────────────────────── */
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
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
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

/* ── 스킬 생성/편집 폼 ───────────────────────────────────── */
function SkillForm({
  initial,
  onClose,
  onSaved,
}: {
  initial?: Skill;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("skillLibrary");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [category, setCategory] = useState(initial?.category ?? "productivity");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = !!initial;

  async function handleSubmit() {
    if (!name.trim()) { setFormError(t("form.nameRequired")); return; }
    if (!content.trim()) { setFormError(t("form.contentRequired")); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (isEdit) {
        await ApiClient.put(`/api/agents/skills/${initial.id}`, { name: name.trim(), description: description.trim(), content: content.trim(), category, isPublic });
      } else {
        await ApiClient.post("/api/agents/skills", { name: name.trim(), description: description.trim(), content: content.trim(), category, isPublic });
      }
      await onSaved();
    } catch (err) {
      setFormError(t("form.saveFailed", { error: err instanceof Error ? err.message : t("serverError") }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("form.nameLabel")}</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("form.namePlaceholder")} autoFocus
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("form.categoryLabel")}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent">
            {Object.entries(CATEGORY_KEYS).map(([k, key]) => (
              <option key={k} value={k}>{t(key)}</option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 self-end">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-accent" />
          <span className="text-xs text-fg-2">{t("form.publicLabel")}</span>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("form.descriptionLabel")}</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder={t("form.descriptionPlaceholder")}
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("form.instructionsLabel")}</span>
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          rows={5} placeholder={t("form.instructionsPlaceholder")}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
      </label>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEdit ? t("save") : t("create")}
        </Button>
      </div>
    </form>
  );
}

/* ── 파일 업로드 폼 ──────────────────────────────────────── */
function UploadForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("skillLibrary");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) { setFormError(t("upload.fileRequired")); return; }
    setUploading(true);
    setFormError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await ApiClient.post<ApiSuccess<{ skill_id: string; version: string; inserted: boolean }>>("/api/agents/skills/upload", fd);
      const d = res?.data;
      setResult(d ? t("upload.successDetail", { id: d.skill_id, version: d.version }) : t("upload.success"));
      await onSaved();
    } catch (err) {
      setFormError(t("upload.failed", { error: err instanceof Error ? err.message : t("serverError") }));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("upload.hint")}</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("upload.fileLabel")}</span>
        <input type="file" accept=".skill,.md"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-fg-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg hover:file:bg-surface-3" />
      </label>
      {result && <p className="text-xs text-success">{result}</p>}
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        <Button onClick={() => void handleUpload()} disabled={!file || uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {t("upload.submit")}
        </Button>
      </div>
    </div>
  );
}

/* ── AI 자동 생성 폼 ─────────────────────────────────────── */
function AutoCreateForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("skillLibrary");
  const [purpose, setPurpose] = useState("");
  const [target, setTarget] = useState("");
  const [category, setCategory] = useState("productivity");
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  function cleanup() {
    esRef.current?.close();
    esRef.current = null;
  }

  useEffect(() => () => cleanup(), []);

  async function handleGenerate() {
    if (!purpose.trim()) { setFormError(t("auto.purposeRequired")); return; }
    setGenerating(true);
    setFormError(null);
    setProgress(t("auto.requesting"));

    // SSE 방식: fetch + ReadableStream 로 파싱
    try {
      const resp = await fetch("/api/agents/skills/auto-create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        credentials: "include",
        body: JSON.stringify({ purpose: purpose.trim(), target: target.trim() || undefined, category }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => t("serverError"));
        setFormError(t("failedStatus", { status: resp.status, error: errText }));
        setGenerating(false);
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
              const phase = (parsed as { phase?: string }).phase;
              setProgress(phase === "llm_call_started" ? t("auto.generating") : t("auto.processing"));
            } else if (eventName === "result") {
              setProgress(t("auto.done"));
              cleanup();
              await onSaved();
              return;
            } else if (eventName === "error") {
              const errMsg = ((parsed as { error?: { message?: string } }).error?.message) || t("auto.generateFailed");
              setFormError(errMsg);
              cleanup();
              setGenerating(false);
              setProgress(null);
              return;
            }
          } catch {
            // JSON 파싱 실패 무시
          }
        }
      }
      await onSaved();
    } catch (err) {
      setFormError(t("requestFailed", { error: err instanceof Error ? err.message : t("networkError") }));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }} className="space-y-4">
      <p className="text-sm text-muted">{t("auto.hint")}</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("auto.purposeLabel")}</span>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)}
          rows={3} autoFocus placeholder={t("auto.purposePlaceholder")}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("auto.targetLabel")}</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)}
            placeholder={t("auto.targetPlaceholder")}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("form.categoryLabel")}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent">
            {Object.entries(CATEGORY_KEYS).map(([k, key]) => (
              <option key={k} value={k}>{t(key)}</option>
            ))}
          </select>
        </label>
      </div>
      {progress && (
        <div className="flex items-center gap-2 text-xs text-accent">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {progress}
        </div>
      )}
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose} disabled={generating}>{t("cancel")}</Button>
        <Button type="submit" disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
          {t("auto.submit")}
        </Button>
      </div>
    </form>
  );
}

/* ── Git URL Ingest 폼 ───────────────────────────────────── */
function GitIngestForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const t = useTranslations("skillLibrary");
  const [gitUrl, setGitUrl] = useState("");
  const [gitRef, setGitRef] = useState("");
  const [gitPath, setGitPath] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleImport() {
    if (!gitUrl.trim()) { setFormError(t("git.urlRequired")); return; }
    setLoading(true);
    setFormError(null);
    setProgress(t("git.fetching"));

    try {
      const resp = await fetch("/api/agents/skills/import-from-git", {
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
        setFormError(t("failedStatus", { status: resp.status, error: errText }));
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
              setProgress(t("git.validating"));
            } else if (eventName === "result") {
              setProgress(t("git.done"));
              setLoading(false);
              await onSaved();
              return;
            } else if (eventName === "error") {
              const errMsg = ((parsed as { error?: { message?: string } }).error?.message) || t("git.importFailed");
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
      <p className="text-sm text-muted">{t("git.hint")}</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("git.urlLabel")}</span>
        <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} autoFocus
          placeholder="https://github.com/owner/repo"
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("git.refLabel")}</span>
          <input value={gitRef} onChange={(e) => setGitRef(e.target.value)}
            placeholder="main"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">{t("git.pathLabel")}</span>
          <input value={gitPath} onChange={(e) => setGitPath(e.target.value)}
            placeholder="SKILL.md"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">{t("git.tokenLabel")}</span>
        <input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)}
          placeholder="ghp_..."
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
          {t("git.submit")}
        </Button>
      </div>
    </form>
  );
}

/* ── 필터 칩 ──────────────────────────────────────────────── */
function FilterChip({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium transition",
        active ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-fg-2 hover:bg-surface-2",
      )}>
      {label}
      <span className={cn("font-mono", active ? "text-accent" : "text-faint")}>{count}</span>
    </button>
  );
}

/* ── 스킬 카드 ────────────────────────────────────────────── */
function SkillCard({
  skill,
  assigned,
  onEdit,
  onDelete,
  onToggleAssign,
  onExport,
}: {
  skill: Skill;
  assigned: boolean;
  onEdit: (s: Skill) => void;
  onDelete: (s: Skill) => void;
  onToggleAssign: (s: Skill, assigned: boolean) => void;
  onExport: (s: Skill) => void;
}) {
  const t = useTranslations("skillLibrary");
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-accent-soft text-accent">
          <Package className="h-4 w-4" />
        </div>
        <Badge tone="neutral">{categoryLabel(t, skill.category)}</Badge>
        {skill.isSystem ? <Badge tone="accent">{t("systemBadge")}</Badge> : <Badge tone="neutral">{t("userBadge")}</Badge>}
      </div>
      <h3 className="mb-1 text-sm font-semibold text-fg">{skill.name}</h3>
      <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-muted">{skill.description}</p>
      <div className="flex items-center gap-1.5 border-t border-border pt-3">
        <button
          onClick={() => onToggleAssign(skill, assigned)}
          title={assigned ? t("card.unassignTitle") : t("card.assignTitle")}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition",
            assigned ? "text-accent hover:bg-accent-soft" : "text-faint hover:bg-surface-2 hover:text-fg",
          )}>
          <Star className="h-3.5 w-3.5" fill={assigned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={() => onExport(skill)}
          title={t("card.exportTitle")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-surface-2 hover:text-fg">
          <Download className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onEdit(skill)}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-2 transition hover:bg-surface-2">
          <Pencil className="h-3 w-3" />{t("edit")}
        </button>
        <button
          onClick={() => onDelete(skill)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-danger-soft hover:text-danger">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </Card>
  );
}

/* ── Draft 탭 ─────────────────────────────────────────────── */
function DraftTab({ onRefresh }: { onRefresh: () => void }) {
  const t = useTranslations("skillLibrary");
  const [drafts, setDrafts] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await ApiClient.get<DraftsResponse>("/api/agents/skills/drafts?target=user");
      setDrafts((res?.data?.drafts ?? []).map(mapSkill));
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadDrafts(); }, [loadDrafts]);

  async function handleApprove(skillId: string) {
    try {
      await ApiClient.post(`/api/agents/skills/${skillId}/approve`, {});
      await loadDrafts();
      onRefresh();
    } catch (err) {
      alert(t("draft.approveFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function handleReject(skillId: string) {
    if (!window.confirm(t("draft.rejectConfirm"))) return;
    try {
      await ApiClient.post(`/api/agents/skills/${skillId}/reject`, {});
      await loadDrafts();
    } catch (err) {
      alert(t("draft.rejectFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <Loader2 className="mb-3 h-6 w-6 animate-spin text-faint" />
        <p className="text-sm text-muted">{t("draft.loading")}</p>
      </div>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <Library className="mb-3 h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-fg-2">{t("draft.emptyTitle")}</p>
        <p className="mt-1 text-sm text-muted">{t("draft.emptyDesc")}</p>
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
                <Badge tone="neutral">{categoryLabel(t, d.category)}</Badge>
              </div>
              <h3 className="text-sm font-semibold text-fg">{d.name}</h3>
              <p className="mt-1 text-xs text-muted line-clamp-2">{d.description}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" onClick={() => void handleApprove(d.id)}>
                <Check className="h-3.5 w-3.5" />{t("draft.approve")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleReject(d.id)}>
                <X className="h-3.5 w-3.5" />{t("draft.reject")}
              </Button>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ── 메인 페이지 ──────────────────────────────────────────── */
export default function SkillLibraryPage() {
  const t = useTranslations("skillLibrary");
  const [skills, setSkills] = useState<Skill[]>(() => buildFallback(t));
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string>(ALL);
  const [tab, setTab] = useState<string>(TAB_ACTIVE);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());

  // 모달 상태
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showAutoCreate, setShowAutoCreate] = useState(false);
  const [showGitIngest, setShowGitIngest] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

  const loadSkills = useCallback(async () => {
    try {
      const res = await ApiClient.get<SkillsResponse>("/api/agents/skills?limit=200");
      setSkills((res?.data?.skills ?? []).map(mapSkill));
    } catch {
      // 401·네트워크 실패: 목업 폴백 유지
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssigned = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApiSuccess<ApiSkill[]>>("/api/agents/skills/user-assigned");
      const list = Array.isArray(res?.data) ? res.data : [];
      setAssignedIds(new Set(list.map((s) => s.id)));
    } catch {
      // 무시
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([loadSkills(), loadAssigned()]);
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [loadSkills, loadAssigned]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skills) counts.set(s.category, (counts.get(s.category) || 0) + 1);
    return Array.from(counts.entries()).map(([id, count]) => ({ id, label: categoryLabel(t, id), count }));
  }, [skills, t]);

  const filtered = active === ALL ? skills : skills.filter((s) => s.category === active);

  async function handleDelete(skill: Skill) {
    if (!window.confirm(t("deleteConfirm", { name: skill.name }))) return;
    try {
      await ApiClient.del(`/api/agents/skills/${skill.id}`);
      await loadSkills();
    } catch (err) {
      alert(t("deleteFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function handleToggleAssign(skill: Skill, currently: boolean) {
    try {
      if (currently) {
        await ApiClient.del(`/api/agents/skills/${skill.id}/user-assign`);
        setAssignedIds((prev) => { const n = new Set(prev); n.delete(skill.id); return n; });
      } else {
        await ApiClient.post(`/api/agents/skills/${skill.id}/user-assign`, {});
        setAssignedIds((prev) => new Set(prev).add(skill.id));
      }
    } catch (err) {
      alert(t("assignFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  function handleExport(skill: Skill) {
    window.open(`/api/agents/skills/${skill.id}/export`, "_blank");
  }

  async function afterSave() {
    setShowCreate(false);
    setShowUpload(false);
    setShowAutoCreate(false);
    setShowGitIngest(false);
    setEditingSkill(null);
    await loadSkills();
  }

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        description={t("pageDescription")}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4" />{t("uploadButton")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowGitIngest(true)}>
              <GitBranch className="h-4 w-4" />{t("gitButton")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAutoCreate(true)}>
              <Cpu className="h-4 w-4" />{t("autoButton")}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />{t("newButton")}
            </Button>
          </>
        }
      />

      {/* 탭 */}
      <div className="flex gap-4 border-b border-border px-6 pt-3">
        {[{ id: TAB_ACTIVE, label: t("tabs.active") }, { id: TAB_DRAFT, label: t("tabs.draft") }].map((tabItem) => (
          <button key={tabItem.id} onClick={() => setTab(tabItem.id)}
            className={cn(
              "pb-2 text-sm font-medium transition border-b-2",
              tab === tabItem.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-fg",
            )}>
            {tabItem.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {tab === TAB_DRAFT ? (
          <DraftTab onRefresh={loadSkills} />
        ) : (
          <>
            {/* 카테고리 필터 */}
            <div className="mb-5 flex flex-wrap gap-2">
              <FilterChip label={t("filterAll")} count={skills.length} active={active === ALL} onClick={() => setActive(ALL)} />
              {categories.map((c) => (
                <FilterChip key={c.id} label={c.label} count={c.count} active={active === c.id} onClick={() => setActive(c.id)} />
              ))}
            </div>

            {loading ? (
              <div className="grid place-items-center py-24 text-center">
                <Library className="mb-3 h-8 w-8 animate-pulse text-faint" />
                <p className="text-sm text-muted">{t("loading")}</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="grid place-items-center py-24 text-center">
                <Library className="mb-3 h-8 w-8 text-faint" />
                <p className="text-sm font-medium text-fg-2">{t("emptyTitle")}</p>
                <p className="mt-1 text-sm text-muted">{t("emptyDesc")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((s) => (
                  <SkillCard
                    key={s.id}
                    skill={s}
                    assigned={assignedIds.has(s.id)}
                    onEdit={setEditingSkill}
                    onDelete={handleDelete}
                    onToggleAssign={handleToggleAssign}
                    onExport={handleExport}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 모달들 */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={t("modal.create")}>
        <SkillForm onClose={() => setShowCreate(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={!!editingSkill} onClose={() => setEditingSkill(null)} title={t("modal.edit")}>
        {editingSkill && (
          <SkillForm initial={editingSkill} onClose={() => setEditingSkill(null)} onSaved={afterSave} />
        )}
      </Modal>

      <Modal open={showUpload} onClose={() => setShowUpload(false)} title={t("modal.upload")}>
        <UploadForm onClose={() => setShowUpload(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={showAutoCreate} onClose={() => setShowAutoCreate(false)} title={t("modal.autoCreate")}>
        <AutoCreateForm onClose={() => setShowAutoCreate(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={showGitIngest} onClose={() => setShowGitIngest(false)} title={t("modal.gitIngest")}>
        <GitIngestForm onClose={() => setShowGitIngest(false)} onSaved={afterSave} />
      </Modal>
    </>
  );
}
