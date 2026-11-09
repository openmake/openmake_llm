"use client";

/**
 * 공유 문서 렌더러 — 미리보기와 공유 페이지가 같은 렌더러를 쓴다(보이는 그대로가 공개된다).
 *
 * 기존 채팅 렌더러를 쓰지 않는다: 첨부 fetch·출처 조회·아티팩트 export 가 일어나면 안 된다.
 * raw HTML 은 렌더하지 않고(skipHtml), 링크는 라벨 텍스트만, 이미지는 제외 표시만 — 외부 리소스 자동 로드·클릭 이동이 없다.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTranslations } from "next-intl";
import type { ConversationShareDocumentV1 } from "@openmake/shared-types";
import { cn } from "@/lib/utils";

function useComponents(): Components {
  const t = useTranslations("conversationShare");
  return {
    a: ({ children }) => <span className="underline decoration-dotted underline-offset-2">{children}</span>,
    img: ({ alt }) => <span className="text-faint">{t("imageOmitted")}{alt ? ` ${alt}` : ""}</span>,
  };
}

export function ConversationShareDocumentView({ document, className }: { document: ConversationShareDocumentV1; className?: string }) {
  const t = useTranslations("conversationShare");
  const components = useComponents();
  return (
    <article className={cn("space-y-4", className)}>
      <h2 className="text-base font-semibold text-fg">{document.title || t("untitled")}</h2>
      <ol className="space-y-3">
        {document.messages.map((m, i) => (
          <li key={i} className={cn("rounded-lg border border-border px-3 py-2", m.role === "user" ? "bg-surface-2" : "bg-surface")}>
            <p className="mb-1 text-xs font-medium text-muted">{m.role === "user" ? t("roleUser") : t("roleAssistant")}</p>
            <div className="prose prose-sm max-w-none break-words text-sm text-fg-2">
              <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
                {m.content}
              </ReactMarkdown>
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
