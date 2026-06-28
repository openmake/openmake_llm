"use client";

import { useEffect, useState } from "react";
import { Boxes, Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";
import {
  PageHeader,
  Card,
  CardContent,
  Badge,
  Button,
  Table,
  Th,
  Td,
} from "@/components/ui/primitives";
import type { ApiSuccess as ApiEnvelope } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

type TransportType = "stdio" | "sse" | "streamable-http";

interface CatalogTemplate {
  id: string;
  display_name: string;
  description?: string;
  transport_type: TransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  is_enabled: boolean;
}

const TRANSPORT_LABEL: Record<TransportType, string> = {
  stdio: "stdio",
  sse: "SSE",
  "streamable-http": "HTTP",
};

const inputCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none";
const selectCls = "h-9 w-full rounded-md border border-border bg-surface-2 px-3 text-sm text-fg focus:border-accent focus:outline-none";
const textareaCls = "w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none resize-none";
const labelCls = "block text-xs font-medium text-fg-2 mb-1";

/* ── 모달 공통 래퍼 ─────────────────────────────────────────── */
function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      role="dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(ev) => { if (ev.currentTarget === ev.target) onClose(); }}
    >
      <div
        className="relative mx-4 w-full max-w-lg rounded-lg bg-surface p-6 shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(ev) => ev.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-faint hover:text-fg"
          aria-label="닫기"
        >
          <X className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  );
}

/* ── 생성/편집 폼 ─────────────────────────────────────────────── */
interface TemplateFormProps {
  initial?: CatalogTemplate;
  onClose: () => void;
  onSaved: () => void;
}

function TemplateFormModal({ initial, onClose, onSaved }: TemplateFormProps) {
  const isEdit = Boolean(initial);
  const [id, setId] = useState(initial?.id ?? "");
  const [displayName, setDisplayName] = useState(initial?.display_name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [transportType, setTransportType] = useState<TransportType>(initial?.transport_type ?? "stdio");
  const [command, setCommand] = useState(initial?.command ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        display_name: displayName,
        description: description || undefined,
        transport_type: transportType,
        command: command || undefined,
        url: url || undefined,
        is_enabled: isEnabled,
      };
      if (isEdit && initial) {
        await ApiClient.put(`/api/admin/mcp/catalog/${initial.id}`, body);
      } else {
        await ApiClient.post("/api/admin/mcp/catalog", { id, ...body });
      }
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "저장 실패. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-4 text-base font-semibold text-fg">
        {isEdit ? "템플릿 편집" : "새 템플릿"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        {!isEdit && (
          <div>
            <label className={labelCls}>ID *</label>
            <input
              className={inputCls}
              required
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="mcp-my-server"
            />
          </div>
        )}
        <div>
          <label className={labelCls}>표시 이름 *</label>
          <input
            className={inputCls}
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My MCP Server"
          />
        </div>
        <div>
          <label className={labelCls}>설명</label>
          <textarea
            className={textareaCls}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="서버에 대한 간략한 설명"
          />
        </div>
        <div>
          <label className={labelCls}>유형 *</label>
          <select
            className={selectCls}
            value={transportType}
            onChange={(e) => setTransportType(e.target.value as TransportType)}
          >
            <option value="stdio">stdio</option>
            <option value="sse">SSE</option>
            <option value="streamable-http">streamable-http</option>
          </select>
        </div>
        {transportType === "stdio" && (
          <div>
            <label className={labelCls}>명령어</label>
            <input
              className={inputCls}
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx -y @modelcontextprotocol/server-…"
            />
          </div>
        )}
        {(transportType === "sse" || transportType === "streamable-http") && (
          <div>
            <label className={labelCls}>URL</label>
            <input
              className={inputCls}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            id="is_enabled"
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          <label htmlFor="is_enabled" className="text-sm text-fg-2">활성화</label>
        </div>
        {error && <p className="text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>취소</Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? "저장" : "생성"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── 삭제 확인 모달 ─────────────────────────────────────────── */
function DeleteTemplateModal({
  template,
  onClose,
  onDeleted,
}: {
  template: CatalogTemplate;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setSubmitting(true);
    setError("");
    try {
      await ApiClient.del(`/api/admin/mcp/catalog/${template.id}`);
      onDeleted();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "삭제 실패. 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <h2 className="mb-2 text-base font-semibold text-fg">템플릿 삭제</h2>
      <p className="mb-1 text-sm text-fg-2">정말 삭제하시겠습니까?</p>
      <p className="mb-4 font-mono text-xs text-muted">{template.id}</p>
      {error && <p className="mb-3 text-xs text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>취소</Button>
        <Button variant="danger" size="sm" onClick={handleDelete} disabled={submitting}>
          {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          삭제
        </Button>
      </div>
    </Modal>
  );
}

/* ── 페이지 ─────────────────────────────────────────────────── */
export default function AdminMcpCatalogPage() {
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<CatalogTemplate | null>(null);
  const [deleteTemplate, setDeleteTemplate] = useState<CatalogTemplate | null>(null);

  async function loadTemplates() {
    try {
      const res = await ApiClient.get<ApiEnvelope<{ templates: CatalogTemplate[]; total: number }>>(
        "/api/admin/mcp/catalog",
      );
      setTemplates(res?.data?.templates ?? []);
    } catch {
      /* 401/실패 시 빈 목록 유지 */
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTemplates();
  }, []);

  return (
    <>
      <PageHeader
        title="MCP 카탈로그 관리"
        description="사용자에게 제공되는 MCP 서버 템플릿을 관리합니다."
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            템플릿 추가
          </Button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr>
                  <Th>ID</Th>
                  <Th>이름</Th>
                  <Th>설명</Th>
                  <Th>유형</Th>
                  <Th>활성여부</Th>
                  <Th>액션</Th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <Td colSpan={6}>
                      <div className="py-12 text-center text-muted">로딩 중…</div>
                    </Td>
                  </tr>
                ) : templates.length === 0 ? (
                  <tr>
                    <Td colSpan={6}>
                      <div className="flex flex-col items-center gap-3 py-12">
                        <Boxes className="h-8 w-8 text-faint" />
                        <p className="text-sm text-muted">등록된 템플릿이 없습니다.</p>
                      </div>
                    </Td>
                  </tr>
                ) : (
                  templates.map((t) => (
                    <tr key={t.id} className="transition hover:bg-surface-2">
                      <Td className="font-mono text-xs text-muted">{t.id}</Td>
                      <Td className="font-medium text-fg">{t.display_name}</Td>
                      <Td className="max-w-xs truncate text-xs text-fg-2">{t.description ?? "-"}</Td>
                      <Td>
                        <Badge tone="neutral">
                          <span className="font-mono">{TRANSPORT_LABEL[t.transport_type]}</span>
                        </Badge>
                      </Td>
                      <Td>
                        <Badge tone={t.is_enabled ? "success" : "neutral"}>
                          {t.is_enabled ? "활성" : "비활성"}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditTemplate(t)}
                            aria-label="편집"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTemplate(t)}
                            aria-label="삭제"
                            className="text-danger hover:text-danger"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {showCreate && (
        <TemplateFormModal
          onClose={() => setShowCreate(false)}
          onSaved={loadTemplates}
        />
      )}
      {editTemplate && (
        <TemplateFormModal
          initial={editTemplate}
          onClose={() => setEditTemplate(null)}
          onSaved={loadTemplates}
        />
      )}
      {deleteTemplate && (
        <DeleteTemplateModal
          template={deleteTemplate}
          onClose={() => setDeleteTemplate(null)}
          onDeleted={loadTemplates}
        />
      )}
    </>
  );
}
