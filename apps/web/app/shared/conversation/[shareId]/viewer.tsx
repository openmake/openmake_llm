"use client";

/**
 * 공유 대화 뷰어 — 서버가 허용한 snapshot 하나만 그대로 렌더한다. 입력창·도구 실행·첨부·대화 재개가 없다.
 *
 * 원본 세션 API 를 호출하지 않는다. 거절(없음·토큰 오류·비멤버·비로그인)은 서버가 모두 같은 404 로 주므로
 * 화면도 구분하지 않는다(존재·조직명 비노출). 요청(shareId·token·계정)이 바뀌거나 거절되면 이전 본문은 보이지 않는다.
 * 인증 동기화(AuthSync — 만료 접근 토큰 갱신 포함)가 끝난 뒤에 조회한다. 먼저 나가면 로그인한 열람자가 게스트로 거절된다.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { LoaderCircle, Lock } from "lucide-react";
import type { SharedConversationView } from "@openmake/shared-types";
import { ConversationShareApi } from "@/lib/api-client";
import { useAppStore } from "@/lib/store";
import { shareLoginHref } from "@/lib/conversation-share";
import { ConversationShareDocumentView } from "@/components/chat/conversation-share-document";

export function SharedConversationViewer({ shareId, token }: { shareId: string; token: string | null }) {
  const t = useTranslations("sharedConversation");
  const tc = useTranslations("conversationShare");
  const format = useFormatter();
  const authResolved = useAppStore((s) => s.authResolved);
  const viewerId = useAppStore((s) => s.auth.currentUser?.id ?? null);
  const requestKey = `${shareId}\n${token ?? ""}\n${viewerId ?? ""}`;
  const [result, setResult] = useState<{ key: string; view: SharedConversationView | null } | null>(null);

  useEffect(() => {
    if (!authResolved) return;
    let cancelled = false;
    ConversationShareApi.read(shareId, token)
      .then((res) => { if (!cancelled) setResult({ key: requestKey, view: res?.data?.document ? res.data : null }); })
      .catch(() => { if (!cancelled) setResult({ key: requestKey, view: null }); });
    return () => { cancelled = true; };
  }, [shareId, token, requestKey, authResolved]);

  const current = result?.key === requestKey ? result : null;
  const view = current?.view ?? null;
  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: "medium", timeStyle: "short" });
  };

  return (
    <div className="min-h-dvh bg-app">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-fg">OpenMake.Ai</span>
          <span className="text-xs text-faint">{t("readOnly")}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {!current ? (
          <div role="status" className="flex items-center justify-center gap-2 py-24 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : !view ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-24 text-center">
            <Lock className="h-8 w-8 text-faint" />
            <p className="text-sm text-fg-2">{t("denied")}</p>
            <p className="text-xs text-faint">{t("deniedHint")}</p>
            <Link href={shareLoginHref(shareId)} className="text-sm font-medium text-accent hover:underline">{t("login")}</Link>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-faint">
              {t("scope", { scope: tc(`scope.${view.visibility}`) })} · {t("snapshotNote", { date: when(view.capturedAt) })}
            </p>
            <ConversationShareDocumentView document={view.document} />
          </div>
        )}
      </main>
    </div>
  );
}
