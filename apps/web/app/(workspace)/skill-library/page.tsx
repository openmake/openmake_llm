"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

/* ── 카테고리 라벨 ─────────────────────────────────────────── */
const CATEGORY_LABELS: Record<string, string> = {
  productivity: "생산성",
  technology: "기술/IT",
  creative: "창작/디자인",
  business: "비즈니스",
  science: "과학/연구",
  communication: "커뮤니케이션",
  finance: "금융/투자",
  education: "교육/학습",
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
const SKILL_FALLBACK: Skill[] = [
  { id: "s1", name: "PDF 요약", category: "productivity", description: "긴 PDF 문서를 핵심 요점으로 압축합니다.", isSystem: true },
  { id: "s2", name: "SQL 쿼리 작성", category: "technology", description: "자연어 요구사항을 파라미터화된 SQL 로 변환합니다.", isSystem: true },
  { id: "s3", name: "광고 카피라이팅", category: "creative", description: "타겟 세그먼트에 맞춘 마케팅 카피를 생성합니다.", isSystem: false },
  { id: "s4", name: "재무 보고서 해석", category: "finance", description: "손익계산서와 대차대조표의 핵심 지표를 해석합니다.", isSystem: false },
];

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

function categoryLabel(id: string) {
  return CATEGORY_LABELS[id] || id || "일반";
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
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [category, setCategory] = useState(initial?.category ?? "productivity");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEdit = !!initial;

  async function handleSubmit() {
    if (!name.trim()) { setFormError("스킬 이름을 입력하세요."); return; }
    if (!content.trim()) { setFormError("스킬 내용(Instructions)을 입력하세요."); return; }
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
      setFormError("저장 실패: " + (err instanceof Error ? err.message : "서버 오류"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleSubmit(); }} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-fg-2">스킬 이름 *</span>
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="예: PDF 요약" autoFocus
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">카테고리</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent">
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2 self-end">
          <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-border accent-accent" />
          <span className="text-xs text-fg-2">공개 스킬</span>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">설명</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="이 스킬이 하는 일을 간단히 설명하세요"
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">Instructions (스킬 내용) *</span>
        <textarea value={content} onChange={(e) => setContent(e.target.value)}
          rows={5} placeholder="이 스킬이 수행할 작업을 상세히 기술하세요..."
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
      </label>
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="outline" onClick={onClose}>취소</Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isEdit ? "저장" : "생성"}
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
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) { setFormError("파일을 선택하세요."); return; }
    setUploading(true);
    setFormError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await ApiClient.post<ApiSuccess<{ skill_id: string; version: string; inserted: boolean }>>("/api/agents/skills/upload", fd);
      const d = res?.data;
      setResult(d ? `업로드 완료: ${d.skill_id} v${d.version}` : "업로드 완료");
      await onSaved();
    } catch (err) {
      setFormError("업로드 실패: " + (err instanceof Error ? err.message : "서버 오류"));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">.SKILL 또는 .md YAML frontmatter 파일을 업로드합니다. (최대 256KB)</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">파일 선택</span>
        <input type="file" accept=".skill,.md"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm text-fg-2 file:mr-3 file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg hover:file:bg-surface-3" />
      </label>
      {result && <p className="text-xs text-success">{result}</p>}
      {formError && <p className="text-xs text-danger">{formError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>취소</Button>
        <Button onClick={() => void handleUpload()} disabled={!file || uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          업로드
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
    if (!purpose.trim()) { setFormError("목적을 입력하세요."); return; }
    setGenerating(true);
    setFormError(null);
    setProgress("생성 요청 중...");

    // SSE 방식: fetch + ReadableStream 로 파싱
    try {
      const resp = await fetch("/api/agents/skills/auto-create", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        credentials: "include",
        body: JSON.stringify({ purpose: purpose.trim(), target: target.trim() || undefined, category }),
      });

      if (!resp.ok || !resp.body) {
        const errText = await resp.text().catch(() => "서버 오류");
        setFormError(`실패 (${resp.status}): ${errText}`);
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
              setProgress(phase === "llm_call_started" ? "LLM 생성 중..." : "처리 중...");
            } else if (eventName === "result") {
              setProgress("생성 완료!");
              cleanup();
              await onSaved();
              return;
            } else if (eventName === "error") {
              const errMsg = ((parsed as { error?: { message?: string } }).error?.message) || "생성 실패";
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
      setFormError("요청 실패: " + (err instanceof Error ? err.message : "네트워크 오류"));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void handleGenerate(); }} className="space-y-4">
      <p className="text-sm text-muted">자연어 목적을 입력하면 LLM이 스킬 매니페스트를 자동 생성합니다.</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">스킬 목적 *</span>
        <textarea value={purpose} onChange={(e) => setPurpose(e.target.value)}
          rows={3} autoFocus placeholder="예: PDF 문서를 업로드하면 핵심 내용을 3줄로 요약하는 스킬"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-fg outline-none focus:border-accent resize-none" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">대상 사용자 (선택)</span>
          <input value={target} onChange={(e) => setTarget(e.target.value)}
            placeholder="예: 연구자, 마케터"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">카테고리</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent">
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
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
        <Button type="button" variant="outline" onClick={onClose} disabled={generating}>취소</Button>
        <Button type="submit" disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cpu className="h-4 w-4" />}
          AI 생성
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
              setProgress("매니페스트 검증 중...");
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
      <p className="text-sm text-muted">GitHub 저장소의 SKILL.md 매니페스트를 가져와 draft로 저장합니다.</p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">GitHub URL *</span>
        <input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} autoFocus
          placeholder="https://github.com/owner/repo"
          className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">브랜치/태그 (선택)</span>
          <input value={gitRef} onChange={(e) => setGitRef(e.target.value)}
            placeholder="main"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-2">파일 경로 (선택)</span>
          <input value={gitPath} onChange={(e) => setGitPath(e.target.value)}
            placeholder="SKILL.md"
            className="h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none focus:border-accent" />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-2">Access Token (비공개 저장소)</span>
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
        <Button type="button" variant="outline" onClick={onClose} disabled={loading}>취소</Button>
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          가져오기
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
  return (
    <Card className="flex flex-col p-5">
      <div className="mb-3 flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-md bg-accent-soft text-accent">
          <Package className="h-4 w-4" />
        </div>
        <Badge tone="neutral">{categoryLabel(skill.category)}</Badge>
        {skill.isSystem ? <Badge tone="accent">시스템</Badge> : <Badge tone="neutral">사용자</Badge>}
      </div>
      <h3 className="mb-1 text-sm font-semibold text-fg">{skill.name}</h3>
      <p className="mb-3 line-clamp-2 flex-1 text-xs leading-relaxed text-muted">{skill.description}</p>
      <div className="flex items-center gap-1.5 border-t border-border pt-3">
        <button
          onClick={() => onToggleAssign(skill, assigned)}
          title={assigned ? "개인 스킬 해제" : "개인 스킬로 추가"}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md transition",
            assigned ? "text-accent hover:bg-accent-soft" : "text-faint hover:bg-surface-2 hover:text-fg",
          )}>
          <Star className="h-3.5 w-3.5" fill={assigned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={() => onExport(skill)}
          title=".SKILL.md 내보내기"
          className="flex h-7 w-7 items-center justify-center rounded-md text-faint transition hover:bg-surface-2 hover:text-fg">
          <Download className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onEdit(skill)}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-fg-2 transition hover:bg-surface-2">
          <Pencil className="h-3 w-3" />편집
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
      alert("승인 실패: " + (err instanceof Error ? err.message : "오류"));
    }
  }

  async function handleReject(skillId: string) {
    if (!window.confirm("이 draft를 거부(보관)하시겠습니까?")) return;
    try {
      await ApiClient.post(`/api/agents/skills/${skillId}/reject`, {});
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
        <Library className="mb-3 h-8 w-8 text-faint" />
        <p className="text-sm font-medium text-fg-2">승인 대기 중인 Draft가 없습니다</p>
        <p className="mt-1 text-sm text-muted">AI 자동생성 또는 Git 가져오기로 생성된 스킬이 여기 나타납니다.</p>
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
                <Badge tone="neutral">{categoryLabel(d.category)}</Badge>
              </div>
              <h3 className="text-sm font-semibold text-fg">{d.name}</h3>
              <p className="mt-1 text-xs text-muted line-clamp-2">{d.description}</p>
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
export default function SkillLibraryPage() {
  const [skills, setSkills] = useState<Skill[]>(SKILL_FALLBACK);
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
    return Array.from(counts.entries()).map(([id, count]) => ({ id, label: categoryLabel(id), count }));
  }, [skills]);

  const filtered = active === ALL ? skills : skills.filter((s) => s.category === active);

  async function handleDelete(skill: Skill) {
    if (!window.confirm(`"${skill.name}" 스킬을 삭제하시겠습니까?`)) return;
    try {
      await ApiClient.del(`/api/agents/skills/${skill.id}`);
      await loadSkills();
    } catch (err) {
      alert("삭제 실패: " + (err instanceof Error ? err.message : "오류"));
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
      alert("할당 변경 실패: " + (err instanceof Error ? err.message : "오류"));
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
        title="스킬 라이브러리"
        description="재사용 가능한 매니페스트와 도구 바인딩을 관리합니다."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
              <Upload className="h-4 w-4" />.SKILL 업로드
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowGitIngest(true)}>
              <GitBranch className="h-4 w-4" />Git 가져오기
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAutoCreate(true)}>
              <Cpu className="h-4 w-4" />AI 자동생성
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4" />새 스킬
            </Button>
          </>
        }
      />

      {/* 탭 */}
      <div className="flex gap-4 border-b border-border px-6 pt-3">
        {[{ id: TAB_ACTIVE, label: "활성 스킬" }, { id: TAB_DRAFT, label: "Draft 검토" }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              "pb-2 text-sm font-medium transition border-b-2",
              tab === t.id
                ? "border-accent text-accent"
                : "border-transparent text-muted hover:text-fg",
            )}>
            {t.label}
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
              <FilterChip label="전체" count={skills.length} active={active === ALL} onClick={() => setActive(ALL)} />
              {categories.map((c) => (
                <FilterChip key={c.id} label={c.label} count={c.count} active={active === c.id} onClick={() => setActive(c.id)} />
              ))}
            </div>

            {loading ? (
              <div className="grid place-items-center py-24 text-center">
                <Library className="mb-3 h-8 w-8 animate-pulse text-faint" />
                <p className="text-sm text-muted">불러오는 중...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="grid place-items-center py-24 text-center">
                <Library className="mb-3 h-8 w-8 text-faint" />
                <p className="text-sm font-medium text-fg-2">스킬이 없습니다</p>
                <p className="mt-1 text-sm text-muted">다른 카테고리를 선택하거나 새 스킬을 추가하세요.</p>
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
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="새 스킬 생성">
        <SkillForm onClose={() => setShowCreate(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={!!editingSkill} onClose={() => setEditingSkill(null)} title="스킬 편집">
        {editingSkill && (
          <SkillForm initial={editingSkill} onClose={() => setEditingSkill(null)} onSaved={afterSave} />
        )}
      </Modal>

      <Modal open={showUpload} onClose={() => setShowUpload(false)} title=".SKILL 파일 업로드">
        <UploadForm onClose={() => setShowUpload(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={showAutoCreate} onClose={() => setShowAutoCreate(false)} title="AI 스킬 자동 생성">
        <AutoCreateForm onClose={() => setShowAutoCreate(false)} onSaved={afterSave} />
      </Modal>

      <Modal open={showGitIngest} onClose={() => setShowGitIngest(false)} title="Git URL에서 스킬 가져오기">
        <GitIngestForm onClose={() => setShowGitIngest(false)} onSaved={afterSave} />
      </Modal>
    </>
  );
}
