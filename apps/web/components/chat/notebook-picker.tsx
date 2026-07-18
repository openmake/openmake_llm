"use client";

/**
 * Composer "Notebooks" picker — 유저의 NotebookLM 노트북 목록을 결정적으로 조회해
 * (GET /api/mcp/notebooklm/notebooks, 백엔드 5분 캐시) 하나를 대화 컨텍스트로 고정한다.
 * 선택하면 composer 가 메시지 앞에 노트북 id/제목 컨텍스트를 주입해 LLM 이
 * notebooklm::notebook_query 로 해당 노트북에 근거해 답하게 한다 (Gemini 노트북 연동 UX).
 *
 * 제어형(controlled): 열림 상태는 composer 가 소유 — 진입점은 '도구' 모드 시트의
 * "노트북 선택" 항목이고, 이 컴포넌트는 선택된 컨텍스트 칩 + 팝오버만 렌더한다.
 * 상태: 미설치(404) → MCP 카탈로그 연결 CTA / 업스트림 실패(502, 쿠키 만료 등) → 재연결 안내.
 */
import { useEffect, useState } from "react";
import { BookOpen, RefreshCw, X, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ApiClient, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface NotebookRef {
  id: string;
  title: string;
}

interface NotebookListItem extends NotebookRef {
  source_count?: number;
  modified_at?: string;
}

interface NotebookListResponse {
  success: boolean;
  data: { notebooks: NotebookListItem[]; fetchedAt: string; cached: boolean };
}

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; notebooks: NotebookListItem[] }
  | { kind: "notInstalled" }
  | { kind: "error"; message: string };

export function NotebookPicker({
  value,
  onChange,
  open,
  onOpenChange,
  suppressed = false,
}: {
  value: NotebookRef | null;
  onChange: (v: NotebookRef | null) => void;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** 노트북 컨텍스트가 적용되지 않는 모드(에이전트/구조화)에서 칩을 흐림+미적용 표시 */
  suppressed?: boolean;
}) {
  const t = useTranslations("composer");
  const router = useRouter();
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  const load = async (refresh = false) => {
    setState({ kind: "loading" });
    try {
      const res = await ApiClient.get<NotebookListResponse>(
        `/api/mcp/notebooklm/notebooks${refresh ? "?refresh=1" : ""}`,
      );
      setState({ kind: "ready", notebooks: res.data.notebooks });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setState({ kind: "notInstalled" });
      else setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };

  // 팝오버가 열릴 때 목록 lazy-load (백엔드 5분 캐시라 재열림은 빠름)
  useEffect(() => {
    if (open && state.kind !== "ready") void load();
    // state.kind 를 deps 에 넣으면 로드 완료 시 재실행되므로 open 전이에만 반응
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {/* 선택된 노트북 = 컨텍스트 칩 (모드 칩과 동일 문법). 진입은 '도구' 시트의 "노트북 선택".
          에이전트/구조화 모드에선 notebooklm 도구가 없어 미적용 — 흐림+태그로 표시 */}
      {value && (
        <span
          className={cn(
            "inline-flex max-w-[14rem] shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
            suppressed ? "border-border text-faint" : "border-accent bg-accent-soft text-accent",
          )}
        >
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            className="truncate hover:opacity-80"
            title={value.title}
          >
            {value.title}
            {suppressed && <span className="ml-1 text-[11px]">{t("suppressedTag")}</span>}
          </button>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("notebooks.clear")}
            className="shrink-0 hover:opacity-80"
          >
            <X className="h-3 w-3 opacity-70" />
          </button>
        </span>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => onOpenChange(false)} aria-hidden />
          <div className="absolute bottom-full left-0 right-0 z-40 mb-2 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface-2 p-1.5 shadow-lg">
            <div className="flex items-center justify-between px-2 pb-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
                {t("notebooks.heading")}
              </p>
              <button
                type="button"
                onClick={() => void load(true)}
                aria-label={t("notebooks.refresh")}
                className="grid h-6 w-6 place-items-center rounded text-muted hover:bg-surface-3 hover:text-fg"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", state.kind === "loading" && "animate-spin")} />
              </button>
            </div>

            {state.kind === "loading" && (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("notebooks.loading")}
              </div>
            )}

            {state.kind === "notInstalled" && (
              <div className="px-3 py-3 text-sm text-muted">
                <p>{t("notebooks.notInstalled")}</p>
                <button
                  type="button"
                  onClick={() => router.push("/mcp-catalog")}
                  className="mt-1.5 text-accent hover:underline"
                >
                  {t("notebooks.installCta")}
                </button>
              </div>
            )}

            {state.kind === "error" && (
              <div className="px-3 py-3 text-sm text-danger">
                <p>{t("notebooks.error")}</p>
                <p className="mt-1 break-all text-xs text-muted">{state.message}</p>
              </div>
            )}

            {state.kind === "ready" && state.notebooks.length === 0 && (
              <p className="px-3 py-3 text-sm text-muted">{t("notebooks.empty")}</p>
            )}

            {state.kind === "ready" &&
              state.notebooks.map((nb) => (
                <button
                  key={nb.id}
                  type="button"
                  onClick={() => {
                    onChange({ id: nb.id, title: nb.title });
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex min-h-[40px] w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm transition hover:bg-surface-3",
                    value !== null && (value as NotebookRef).id === nb.id ? "text-accent" : "text-fg-2",
                  )}
                >
                  <BookOpen className="h-4 w-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{nb.title}</span>
                    {typeof nb.source_count === "number" && (
                      <span className="block text-[11px] text-faint">
                        {t("notebooks.sourceCount", { count: nb.source_count })}
                      </span>
                    )}
                  </span>
                </button>
              ))}
          </div>
        </>
      )}
    </>
  );
}
