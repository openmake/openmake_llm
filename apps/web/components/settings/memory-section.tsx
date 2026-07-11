"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Brain, Plus, Trash2, Loader2 } from "lucide-react";
import { Button, Card, CardHeader, CardTitle, CardContent } from "@/components/ui/primitives";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

interface Memory {
  id: string;
  content: string;
  created_at?: string;
}

interface MemoriesPayload {
  memories: Memory[];
  maxCount: number;
  maxContent: number;
}

/**
 * 크로스 대화 메모리 관리 — 구 /memory 페이지 본문을 설정 '메모리' 탭으로 흡수한 것
 * (2026-07-11 사이드바 통폐합). 구 라우트 /memory 는 /settings?tab=memory 로 redirect.
 */
export function MemorySection() {
  const t = useTranslations("memory");
  const [memories, setMemories] = useState<Memory[]>([]);
  const [maxCount, setMaxCount] = useState(50);
  const [maxContent, setMaxContent] = useState(2000);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await ApiClient.get<ApiSuccess<MemoriesPayload>>("/api/users/me/memories");
      setMemories(res?.data?.memories ?? []);
      if (res?.data?.maxCount) setMaxCount(res.data.maxCount);
      if (res?.data?.maxContent) setMaxContent(res.data.maxContent);
    } catch {
      /* 비로그인/실패 — 빈 목록 유지 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    const content = draft.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      const res = await ApiClient.post<ApiSuccess<{ memory: Memory }>>("/api/users/me/memories", { content });
      const created = res?.data?.memory;
      if (created) setMemories((prev) => [created, ...prev]);
      setDraft("");
    } catch {
      /* 실패 — 재시도 가능 */
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    const prev = memories;
    setMemories((m) => m.filter((x) => x.id !== id));
    try {
      await ApiClient.del(`/api/users/me/memories/${id}`);
    } catch {
      setMemories(prev); // 실패 시 롤백
    }
  }

  async function clearAll() {
    if (!window.confirm(t("clearConfirm"))) return;
    const prev = memories;
    setMemories([]);
    try {
      await ApiClient.del("/api/users/me/memories");
    } catch {
      setMemories(prev);
    }
  }

  const atLimit = memories.length >= maxCount;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <p className="mt-1 text-xs text-muted">{t("description")}</p>
        </div>
        {memories.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => void clearAll()}>
            <Trash2 className="h-4 w-4" />
            {t("clearAll")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={maxContent}
            rows={3}
            placeholder={t("addPlaceholder")}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-border-strong"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted">
              {draft.length}/{maxContent} · {memories.length}/{maxCount}
            </span>
            <Button onClick={() => void add()} disabled={adding || !draft.trim() || atLimit} size="sm">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("add")}
            </Button>
          </div>
          {atLimit && <p className="mt-1.5 text-xs text-warn">{t("limitReached", { max: maxCount })}</p>}
        </div>

        {loading ? (
          <div className="flex justify-center py-10 text-muted">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center text-muted">
            <Brain className="h-8 w-8 opacity-50" />
            <p className="text-sm">{t("empty")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {memories.map((m) => (
              <li key={m.id}>
                <div className="flex items-start gap-3 rounded-lg border border-border p-3.5">
                  <Brain className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm text-fg">{m.content}</p>
                  <Button variant="ghost" size="icon" aria-label={t("deleteAria")} onClick={() => void remove(m.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
