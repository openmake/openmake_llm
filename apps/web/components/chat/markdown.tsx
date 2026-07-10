"use client";

import { Fragment } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { KakaoMap } from "./kakao-map";

/**
 * 마크다운 렌더러. react-markdown 은 기본적으로 raw HTML 을 렌더하지 않으므로
 * (rehype-raw 미사용) XSS 안전 — 기존 sanitize.js 화이트리스트 역할을 대체.
 * GFM(표/체크박스/취소선) + 코드 하이라이트 지원.
 *
 * 추가: ```kakaomap 펜스 블록(장소 좌표 JSON)은 KakaoMap 컴포넌트로 렌더한다.
 * 카카오 도구 결과가 동봉한 블록으로, 채팅 안에 실제 카카오 지도를 표시한다.
 */

const MD_COMPONENTS: Components = {
  a: ({ ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-accent underline underline-offset-2 hover:text-accent-hover"
    />
  ),
  img: ({ ...props }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      alt={props.alt || ""}
      loading="lazy"
      className="my-2 max-w-full rounded-lg border border-border"
    />
  ),
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
};

// ```kakaomap\n{json}\n``` 블록 추출. 스트리밍 중 닫히지 않은 블록은 매칭 안 돼 원문 유지.
const KAKAOMAP_RE = /```kakaomap\s*\n([\s\S]*?)```/g;
// 도구가 실어보내는 안내 마커 라인 — 모델이 그대로 옮겨도 표시되지 않게 제거.
const GUIDE_MARKER_RE = /^\s*\[지도 표시용[^\]]*\]\s*$/gm;

interface MapSegment {
  kind: "map";
  places: { name: string; lat: number; lng: number; address?: string; url?: string }[];
  route?: { lat: number; lng: number }[];
}
interface TextSegment {
  kind: "text";
  text: string;
}

function splitSegments(content: string): (MapSegment | TextSegment)[] {
  const segments: (MapSegment | TextSegment)[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  KAKAOMAP_RE.lastIndex = 0;
  while ((m = KAKAOMAP_RE.exec(content)) !== null) {
    let parsed: MapSegment["places"] | null = null;
    let parsedRoute: MapSegment["route"];
    try {
      const obj = JSON.parse(m[1].trim());
      if (Array.isArray(obj?.places)) parsed = obj.places;
      if (Array.isArray(obj?.route)) parsedRoute = obj.route;
    } catch {
      parsed = null;
    }
    if (parsed) {
      const before = content.slice(lastIndex, m.index);
      if (before.trim()) segments.push({ kind: "text", text: before });
      segments.push({ kind: "map", places: parsed, route: parsedRoute });
      lastIndex = KAKAOMAP_RE.lastIndex;
    }
  }
  const rest = content.slice(lastIndex);
  if (rest.trim() || segments.length === 0) segments.push({ kind: "text", text: rest });
  return segments;
}

function MarkdownText({ text }: { text: string }) {
  const cleaned = text.replace(GUIDE_MARKER_RE, "").trimEnd();
  if (!cleaned) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={MD_COMPONENTS}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

export function Markdown({ content }: { content: string }) {
  const segments = splitSegments(content);
  return (
    <div className="prose-chat break-words">
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {seg.kind === "map" ? (
            <KakaoMap places={seg.places} route={seg.route} />
          ) : (
            <MarkdownText text={seg.text} />
          )}
        </Fragment>
      ))}
    </div>
  );
}
