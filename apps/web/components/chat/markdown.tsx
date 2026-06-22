"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

/**
 * 마크다운 렌더러. react-markdown 은 기본적으로 raw HTML 을 렌더하지 않으므로
 * (rehype-raw 미사용) XSS 안전 — 기존 sanitize.js 화이트리스트 역할을 대체.
 * GFM(표/체크박스/취소선) + 코드 하이라이트 지원.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          a: ({ ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent underline underline-offset-2 hover:text-accent-hover"
            />
          ),
          // 넓은 표는 가로 스크롤 컨테이너로 감싸 모바일에서 페이지 전체가 넘치지 않게 한다.
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          code: ({ className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            if (isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[0.85em] text-fg"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3.5 text-sm">
              {children}
            </pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
