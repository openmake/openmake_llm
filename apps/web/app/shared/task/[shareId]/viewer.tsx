"use client";

/**
 * 공유 뷰어 — 스냅샷 문서 하나를 그대로 렌더한다.
 *
 * 원본 작업 API 를 절대 호출하지 않는다(공개 방문자에게 권한이 없고, 스냅샷 고정 원칙에도 어긋난다).
 * 접근 불가·부재는 서버가 모두 404 로 응답하므로 화면도 둘을 구분하지 않는다(존재 은닉).
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ExternalLink, LoaderCircle, Lock } from "lucide-react";
import { Badge, Card, CardContent } from "@/components/ui/primitives";
import { DiffView } from "@/components/chat/diff-view";
import { getSharedTask, openSharedArtifact, type ShareDocument } from "@/lib/share-task";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, "success" | "danger" | "accent" | "neutral"> = {
  completed: "success",
  failed: "danger",
  running: "accent",
  cancelled: "neutral",
};

export function SharedTaskViewer({ shareId, token }: { shareId: string; token: string | null }) {
  const t = useTranslations("sharedTask");
  const [doc, setDoc] = useState<ShareDocument | null>(null);
  const [sharedAt, setSharedAt] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied">("loading");
  const [opening, setOpening] = useState<number | null>(null);

  // 산출물 열기 — 토큰은 여기서 발급받는다(스냅샷에 없다). 새 탭은 클릭 직후에 열어야
  // 팝업 차단에 걸리지 않으므로, 먼저 열고 URL 을 받은 뒤 이동시킨다.
  const openArtifact = async (index: number) => {
    setOpening(index);
    const tab = window.open("", "_blank", "noopener");
    try {
      const res = await openSharedArtifact(shareId, index, token);
      const url = res?.data?.url;
      if (!url) throw new Error("no url");
      if (tab) tab.location.href = url;
      else window.location.href = url;
    } catch {
      tab?.close();
    } finally {
      setOpening(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getSharedTask(shareId, token)
      .then((res) => {
        if (cancelled) return;
        setDoc(res?.data?.document ?? null);
        setSharedAt(res?.data?.sharedAt ?? null);
        setState(res?.data?.document ? "ok" : "denied");
      })
      .catch(() => { if (!cancelled) setState("denied"); });
    return () => { cancelled = true; };
  }, [shareId, token]);

  return (
    <div className="min-h-dvh bg-app">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.svg" alt="OpenMake" width={22} height={22} />
            <span className="text-sm font-medium text-fg">OpenMake.Ai</span>
          </Link>
          <span className="text-xs text-faint">{t("readOnly")}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {state === "loading" ? (
          <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : state === "denied" || !doc ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Lock className="h-8 w-8 text-faint" />
            <p className="text-sm text-fg-2">{t("notFound")}</p>
            <p className="text-xs text-faint">{t("notFoundHint")}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[doc.status] ?? "neutral"}>{doc.status}</Badge>
              <span className="text-xs text-faint">
                {t("summaryLine", {
                  turns: doc.summary.turns,
                  tools: doc.summary.toolCalls,
                })}
                {doc.summary.retries > 0 ? ` · ${t("retries", { n: doc.summary.retries })}` : ""}
                {doc.summary.diffs > 0 ? ` · ${t("diffCount", { n: doc.summary.diffs })}` : ""}
              </span>
            </div>

            <Card>
              <CardContent className="space-y-1 pt-4">
                <p className="text-xs font-medium text-muted">{t("goal")}</p>
                <p className="whitespace-pre-wrap text-sm text-fg">{doc.goal || "—"}</p>
              </CardContent>
            </Card>

            {doc.result && (
              <Card>
                <CardContent className="space-y-1 pt-4">
                  <p className="text-xs font-medium text-muted">{t("result")}</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-2">{doc.result}</p>
                </CardContent>
              </Card>
            )}

            {doc.artifacts.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-fg-2">{t("artifacts", { count: doc.artifacts.length })}</h2>
                {doc.artifacts.map((a, i) => (
                  <Card key={a.id || `${a.title}-${i}`}>
                    <CardContent className="space-y-2 pt-4">
                      <p className="flex flex-wrap items-center gap-2 text-sm text-fg">
                        {a.title}
                        <Badge tone="neutral">{a.kind}</Badge>
                        {a.viewerId && (
                          <button
                            type="button"
                            onClick={() => void openArtifact(i)}
                            disabled={opening === i}
                            className="inline-flex items-center gap-1 text-xs text-accent hover:underline disabled:opacity-60"
                          >
                            {opening === i
                              ? <LoaderCircle className="h-3 w-3 animate-spin" />
                              : <ExternalLink className="h-3 w-3" />}
                            {t("openArtifact")}
                          </button>
                        )}
                      </p>
                      {/* 본문은 항상 텍스트로만 — 마크업 렌더는 별도 오리진·CSP 격리가 필요하다 */}
                      {a.body ? (
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-surface-2 px-2 py-1.5 text-xs leading-relaxed text-muted">
                          {a.body}
                        </pre>
                      ) : (
                        <p className="text-xs text-faint">
                          {a.viewerId
                            ? t("artifactViewerOnly")
                            : t(a.omitted === "markup" ? "artifactMarkupOmitted" : "artifactUnavailable")}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </section>
            )}

            {doc.steps.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-fg-2">{t("steps", { count: doc.steps.length })}</h2>
                <ul className="space-y-1.5">
                  {doc.steps.map((s) => (
                    <li key={s.n} className="flex gap-2 text-xs">
                      <span className="w-6 shrink-0 text-right font-mono text-faint">{s.n}</span>
                      <span className={cn(
                        "min-w-0 flex-1 rounded px-2 py-1",
                        s.type === "judge" ? "bg-surface-2 text-fg-2" : "bg-surface-2 font-mono text-muted",
                      )}>
                        {s.tool && <span className="mr-1 text-accent">{s.tool}</span>}
                        {s.text}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {doc.diffs.length > 0 && (
              <section className="space-y-2">
                <h2 className="text-xs font-medium text-fg-2">{t("changes", { count: doc.diffs.length })}</h2>
                {doc.diffs.map((d, i) => <DiffView key={i} text={d} />)}
              </section>
            )}

            <p className="border-t border-border pt-4 text-xs text-faint">
              {t("snapshotNote")}
              {sharedAt ? ` (${new Date(sharedAt).toLocaleString()})` : ""}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
