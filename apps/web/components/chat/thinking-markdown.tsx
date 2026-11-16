"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 사고(thinking) 패널용 제한 마크다운 — 굵게·기울임·취소선·코드·목록·인용만 요소로 그린다.
 * raw HTML 은 쓰지 않고(rehype-raw 없음), 링크·이미지·표는 글자로 풀린다 — 사고문이 원격 이미지를 부르거나
 * add-on 블록·인용 칩을 띄우지 않게 본문 Markdown 을 그대로 쓰지 않는다. 제목은 블록 굵은 글씨로 그린다.
 * 단락 안 한 줄 바꿈은 p 에서만 유지한다(로컬 모델 사고문은 줄 단위로 쓴다 — li 는 항목 사이 빈 줄이 생겨 제외).
 */
const ALLOWED = ["p", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "br", "img", "h1", "h2", "h3", "h4", "h5", "h6"];

const heading: Components["h1"] = ({ children }) => <strong className="block">{children}</strong>;

const COMPONENTS: Components = {
  p: ({ children }) => <p className="whitespace-pre-line">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-4">{children}</ul>,
  // start 유지 — 타임라인은 빈 줄로 단락을 나눠 따로 그리므로 `2. …` 로 시작하는 단락은 혼자 2 부터 세야 한다
  ol: ({ children, start }) => <ol start={start} className="list-decimal pl-4">{children}</ol>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-2">{children}</blockquote>,
  pre: ({ children }) => <pre className="overflow-x-auto rounded bg-surface-2 p-2">{children}</pre>,
  // 이미지는 불러오지 않고 대체 글만 남긴다
  img: ({ alt }) => <>{alt ?? ""}</>,
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
};

export const ThinkingMarkdown = memo(function ThinkingMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 space-y-1 break-words leading-relaxed text-muted">
      <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={ALLOWED} unwrapDisallowed components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const FENCE_RE = /^\s*(```|~~~)/;

/** 사고문을 빈 줄 기준 단락으로 나눈다 — 코드펜스 안의 빈 줄에서는 나누지 않는다. */
export function splitThinkingParagraphs(text: string): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let inFence = false;
  const flush = () => {
    const p = current.join("\n").trim();
    if (p) out.push(p);
    current = [];
  };
  for (const line of text.split("\n")) {
    if (FENCE_RE.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return out;
}
