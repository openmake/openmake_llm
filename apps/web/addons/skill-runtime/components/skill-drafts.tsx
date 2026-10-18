"use client";

/**
 * 스킬 승인 대기 목록 — 확장별 묶음 + 일괄 승인·거부 + 호환 재작성 제안.
 *
 * 원래 skill-library 의 "Draft 검토" 탭에 있었으나, 승인 위치가 스킬(/skill-library)과
 * MCP(설정→커넥터)로 나뉘어 있어 사용자가 찾지 못하는 문제가 있었다. 승인 창구를
 * `/approvals` 한 곳으로 통합하면서 이 컴포넌트로 추출했다.
 *
 * @see app/(workspace)/approvals/page.tsx
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, X, Loader2, Wand2, Package, Library } from "lucide-react";
import { Button, Badge, Card } from "@/components/ui/primitives";
import { ApiClient } from "@/lib/api-client";
import { DiffView } from "@/components/chat/diff-view";
import { CATEGORY_KEYS, type Translate } from "@/lib/skill-categories";

interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  status?: string;
  extensionName?: string;
}

interface ApiSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  status?: string;
  extensionId?: string;
  extensionName?: string;
}

type DraftsResponse = { data?: { drafts: ApiSkill[] } };

function mapSkill(s: ApiSkill): Skill {
  return {
    id: s.id,
    name: s.name,
    category: s.category || "general",
    description: s.description || "",
    status: s.status,
    extensionName: s.extensionName,
  };
}

function categoryLabel(t: Translate, id: string): string {
  const key = CATEGORY_KEYS[id];
  return key ? t(key) : id;
}

interface RewriteProposal {
  content: string;
  summary: string[];
  model: string;
  diff: string;
  stats: { additions: number; deletions: number };
}

type RewriteState =
  | { state: "loading" }
  | { state: "none" }
  | { state: "ready"; proposal: RewriteProposal }
  | { state: "applying" }
  | { state: "failed" };

export function SkillDrafts({ onRefreshAction }: { onRefreshAction?: () => void }) {
  const t = useTranslations("skillLibrary");
  const [drafts, setDrafts] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  // 설치 시 적응 Phase 3 — 재작성 제안은 diff 를 확인하고 명시 적용할 때만 반영된다
  const [rewrites, setRewrites] = useState<Record<string, RewriteState>>({});
  // 일괄 처리 — 확장 하나가 스킬 8개를 만들기도 해서 하나씩 누르는 부담이 컸다
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

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

  // 확장별 묶음 — 확장 유래가 아닌 draft 는 마지막 '기타' 그룹으로
  const groups = (() => {
    const byExt = new Map<string, Skill[]>();
    for (const d of drafts) {
      const key = d.extensionName ?? "";
      const list = byExt.get(key);
      if (list) list.push(d);
      else byExt.set(key, [d]);
    }
    return [...byExt.entries()]
      .sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])))
      .map(([name, items]) => ({ name, items }));
  })();

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(items: Skill[]) {
    const ids = items.map((i) => i.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allOn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function handleBulk(action: "approve" | "reject") {
    const skillIds = [...selected];
    if (skillIds.length === 0) return;
    if (!window.confirm(t(action === "approve" ? "draft.bulk.approveConfirm" : "draft.bulk.rejectConfirm", { count: skillIds.length }))) return;
    setBulkBusy(true);
    try {
      const res = await ApiClient.post<{ data?: { succeeded: number; requested: number } }>(
        "/api/agents/skills/drafts/bulk",
        { skillIds, action },
      );
      const d = res?.data;
      // 부분 성공을 그대로 알린다 — 전부 됐다고 뭉뚱그리지 않는다
      if (d && d.succeeded < d.requested) {
        alert(t("draft.bulk.partial", { ok: d.succeeded, total: d.requested }));
      }
      setSelected(new Set());
      await loadDrafts();
      onRefreshAction?.();
    } catch (err) {
      alert(t("draft.bulk.failed", { error: err instanceof Error ? err.message : t("genericError") }));
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleApprove(skillId: string) {
    try {
      await ApiClient.post(`/api/agents/skills/${skillId}/approve`, {});
      await loadDrafts();
      onRefreshAction?.();
    } catch (err) {
      alert(t("draft.approveFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  async function requestRewrite(skillId: string) {
    setRewrites((m) => ({ ...m, [skillId]: { state: "loading" } }));
    try {
      const res = await ApiClient.post<{ data?: { proposal: RewriteProposal | null } }>(
        `/api/agents/skills/${skillId}/rewrite-proposal`,
        {},
      );
      const proposal = res?.data?.proposal ?? null;
      setRewrites((m) => ({ ...m, [skillId]: proposal ? { state: "ready", proposal } : { state: "none" } }));
    } catch {
      setRewrites((m) => ({ ...m, [skillId]: { state: "failed" } }));
    }
  }

  async function applyRewrite(skillId: string, content: string) {
    setRewrites((m) => ({ ...m, [skillId]: { state: "applying" } }));
    try {
      await ApiClient.put(`/api/agents/skills/${skillId}`, { content });
      setRewrites((m) => {
        const next = { ...m };
        delete next[skillId];
        return next;
      });
      await loadDrafts();
    } catch (err) {
      setRewrites((m) => ({ ...m, [skillId]: { state: "failed" } }));
      alert(t("draft.rewrite.applyFailed", { error: err instanceof Error ? err.message : t("genericError") }));
    }
  }

  function dismissRewrite(skillId: string) {
    setRewrites((m) => {
      const next = { ...m };
      delete next[skillId];
      return next;
    });
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

  const allIds = drafts.map((d) => d.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  return (
    <div className="space-y-3">
      {/* 일괄 처리 바 — 선택이 있을 때만 액션을 노출해 오조작을 줄인다 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-[var(--accent)]"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(allIds))}
          />
          {t("draft.bulk.selectAll", { count: drafts.length })}
        </label>
        <span className="text-xs text-muted">{t("draft.bulk.selected", { count: selected.size })}</span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" disabled={selected.size === 0 || bulkBusy} onClick={() => void handleBulk("approve")}>
            {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t("draft.bulk.approve")}
          </Button>
          <Button variant="outline" size="sm" disabled={selected.size === 0 || bulkBusy} onClick={() => void handleBulk("reject")}>
            <X className="h-3.5 w-3.5" />{t("draft.bulk.reject")}
          </Button>
        </div>
      </div>

      {groups.map((g) => (
        <div key={g.name || "__other__"} className="space-y-2">
          {/* 확장별 묶음 — 한 확장이 스킬 여러 개를 만들어 함께 처리할 일이 많다 */}
          <div className="flex items-center gap-2 px-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-fg-2">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-[var(--accent)]"
                checked={g.items.every((i) => selected.has(i.id))}
                onChange={() => toggleGroup(g.items)}
              />
              {g.name ? (
                <><Package className="h-3.5 w-3.5 text-accent" />{g.name}</>
              ) : (
                t("draft.bulk.otherGroup")
              )}
            </label>
            <span className="text-xs text-muted">({g.items.length})</span>
          </div>

          {g.items.map((d) => (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]"
                  checked={selected.has(d.id)}
                  onChange={() => toggleOne(d.id)}
                  aria-label={d.name}
                />
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone="warn">Draft</Badge>
                    <Badge tone="neutral">{categoryLabel(t, d.category)}</Badge>
                  </div>
                  <h3 className="text-sm font-semibold text-fg">{d.name}</h3>
                  <p className="mt-1 text-xs text-muted line-clamp-2">{d.description}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={rewrites[d.id]?.state === "loading" || rewrites[d.id]?.state === "applying"}
                    onClick={() => void requestRewrite(d.id)}
                  >
                    {rewrites[d.id]?.state === "loading" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="h-3.5 w-3.5" />
                    )}
                    {t("draft.rewrite.button")}
                  </Button>
                  <Button size="sm" onClick={() => void handleApprove(d.id)}>
                    <Check className="h-3.5 w-3.5" />{t("draft.approve")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleReject(d.id)}>
                    <X className="h-3.5 w-3.5" />{t("draft.reject")}
                  </Button>
                </div>
              </div>
              <RewritePanel
                state={rewrites[d.id]}
                onApply={(content) => void applyRewrite(d.id, content)}
                onDismiss={() => dismissRewrite(d.id)}
              />
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * 재작성 제안 패널 — 적용 전 diff 를 반드시 보여준다 (LLM 재작성의 자동 적용 금지).
 * 기존 채팅 diff 뷰어(components/chat/diff-view.tsx)를 그대로 재사용한다.
 */
function RewritePanel({
  state,
  onApply,
  onDismiss,
}: {
  state?: RewriteState;
  onApply: (content: string) => void;
  onDismiss: () => void;
}) {
  const t = useTranslations("skillLibrary");
  if (!state) return null;

  if (state.state === "loading" || state.state === "applying") {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {state.state === "loading" ? t("draft.rewrite.analyzing") : t("draft.rewrite.applying")}
      </div>
    );
  }
  if (state.state === "none") {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
        <span>{t("draft.rewrite.noChange")}</span>
        <button type="button" className="text-accent hover:underline" onClick={onDismiss}>
          {t("draft.rewrite.dismiss")}
        </button>
      </div>
    );
  }
  if (state.state === "failed") {
    return (
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-warn">
        <span>{t("draft.rewrite.failed")}</span>
        <button type="button" className="text-accent hover:underline" onClick={onDismiss}>
          {t("draft.rewrite.dismiss")}
        </button>
      </div>
    );
  }

  const { proposal } = state;
  return (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-fg-2">{t("draft.rewrite.proposalTitle")}</span>
        <span className="text-success">+{proposal.stats.additions}</span>
        <span className="text-danger">−{proposal.stats.deletions}</span>
        <span className="font-mono text-faint">{proposal.model}</span>
      </div>
      {proposal.summary.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted">
          {proposal.summary.map((line, i) => (
            <li key={i}>· {line}</li>
          ))}
        </ul>
      )}
      <div className="max-h-80 overflow-auto">
        <DiffView text={proposal.diff} />
      </div>
      <p className="text-[11px] text-muted">{t("draft.rewrite.reviewHint")}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onApply(proposal.content)}>
          <Check className="h-3.5 w-3.5" />{t("draft.rewrite.apply")}
        </Button>
        <Button variant="outline" size="sm" onClick={onDismiss}>
          <X className="h-3.5 w-3.5" />{t("draft.rewrite.discard")}
        </Button>
      </div>
    </div>
  );
}

