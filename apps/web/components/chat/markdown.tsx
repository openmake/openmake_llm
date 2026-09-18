"use client";

import { Fragment, useMemo } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useTranslations } from "next-intl";
import { WEB_ADDONS } from "@/addons/registry";
import { CitationChip } from "./citation-chip";
import { citationNumber, linkCitations } from "@/lib/citations";
import type { SearchSourceRef } from "@openmake/shared-types";

/**
 * 마크다운 렌더러. react-markdown 은 기본적으로 raw HTML 을 렌더하지 않으므로
 * (rehype-raw 미사용) XSS 안전 — 기존 sanitize.js 화이트리스트 역할을 대체.
 * GFM(표/체크박스/취소선) + 코드 하이라이트 지원.
 *
 * 추가: add-on 이 등록한 펜스 블록(예: 지도 블록)은 그 add-on 의 컴포넌트로 렌더한다 (addons/registry).
 * 카카오 도구 결과가 동봉한 블록으로, 채팅 안에 실제 카카오 지도를 표시한다.
 *
 * 추가(P1 보고서 파이프라인): ```reportdata 펜스 블록(보고서 데이터 JSON)은 대형 JSON 이
 * 그대로 노출되지 않게 접는다. 스트리밍 중(미닫힘)은 진행 칩, 닫힌 블록은 접힌 details —
 * 정상 경로에선 done 시 서버 cleanedContent 가 블록을 제거하므로 details 는 렌더 실패
 * fail-open 잔존분에만 나타난다.
 */

/** 서버가 만든 미디어(`/generated/*`)의 확장자 → 인라인 플레이어 종류.
 *  오케스트레이터는 음성·영상을 `[🔊 …](/generated/x.wav)` 같은 **링크**로 붙이므로
 *  링크 그대로 두면 새 탭으로 나가야 들을 수 있다(2026-09-13 라이브 점검). 브라우저가
 *  재생할 수 있는 형식은 대화 안에서 바로 재생한다. 외부 URL 은 대상이 아니다(서버 소유 경로만). */
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|opus|flac|aac)(\?|$)/i;
const VIDEO_EXT = /\.(webm|mp4|mov|m4v)(\?|$)/i;
const isGeneratedMedia = (href: string | undefined): "audio" | "video" | null => {
  if (!href || !href.startsWith("/generated/")) return null;
  if (AUDIO_EXT.test(href)) return "audio";
  if (VIDEO_EXT.test(href)) return "video";
  return null;
};

type LinkProps = ComponentPropsWithoutRef<"a"> & ExtraProps;

function MarkdownLink({ ...props }: LinkProps) {
  const kind = isGeneratedMedia(typeof props.href === "string" ? props.href : undefined);
  if (kind === "audio") {
    return (
      <span className="my-2 block">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls preload="metadata" src={props.href} className="w-full max-w-md">
          <a href={props.href}>{props.children}</a>
        </audio>
      </span>
    );
  }
  if (kind === "video") {
    return (
      <span className="my-2 block">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video controls preload="metadata" src={props.href} className="max-h-[420px] w-full max-w-xl rounded-lg border border-border">
          <a href={props.href}>{props.children}</a>
        </video>
      </span>
    );
  }
  return (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-accent underline underline-offset-2 hover:text-accent-hover"
    />
  );
}

const MD_COMPONENTS: Components = {
  a: MarkdownLink,
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

// ```reportdata\n{json}\n``` 닫힌 블록 + 스트리밍 중 미닫힘 잔여(문서 끝까지).
const REPORTDATA_CLOSED_RE = /```reportdata\s*\n([\s\S]*?)```/g;
const REPORTDATA_OPEN_RE = /```reportdata(?:\s*\n[\s\S]*)?$/;

/** add-on 이 가져가 직접 렌더하는 블록 (addons/types.ts MessageBlockExtension) — 예: 지도 블록 */
const BLOCK_EXTENSIONS = WEB_ADDONS.flatMap((a) => a.messageBlocks ?? []);

interface AddonBlockSegment {
  kind: "addon";
  node: ReactNode;
}
interface TextSegment {
  kind: "text";
  text: string;
}
interface ReportSegment {
  kind: "report";
  /** 닫힌 블록의 JSON 원문 (미닫힘 스트리밍 중엔 빈 문자열) */
  json: string;
  /** true = 스트리밍 중 미닫힘 (진행 칩), false = 닫힌 블록 (접힌 details) */
  streaming: boolean;
}

/** reportdata 블록을 본문에서 분리 — 대형 JSON 원문이 채팅에 그대로 노출되지 않게. */
function splitReportSegments(content: string): (TextSegment | ReportSegment)[] {
  const segments: (TextSegment | ReportSegment)[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  REPORTDATA_CLOSED_RE.lastIndex = 0;
  while ((m = REPORTDATA_CLOSED_RE.exec(content)) !== null) {
    const before = content.slice(lastIndex, m.index);
    if (before.trim()) segments.push({ kind: "text", text: before });
    segments.push({ kind: "report", json: m[1].trim(), streaming: false });
    lastIndex = REPORTDATA_CLOSED_RE.lastIndex;
  }
  const rest = content.slice(lastIndex);
  const open = REPORTDATA_OPEN_RE.exec(rest);
  if (open) {
    const before = rest.slice(0, open.index);
    if (before.trim()) segments.push({ kind: "text", text: before });
    segments.push({ kind: "report", json: "", streaming: true });
  } else if (rest.trim() || segments.length === 0) {
    segments.push({ kind: "text", text: rest });
  }
  return segments;
}

/** 한 확장의 닫힌 블록을 떼어 낸다 — render 가 null 이면(파싱 실패) 그 구간은 텍스트로 남는다. */
function splitByExtension(content: string, ext: (typeof BLOCK_EXTENSIONS)[number]): (AddonBlockSegment | TextSegment)[] {
  const segments: (AddonBlockSegment | TextSegment)[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  ext.pattern.lastIndex = 0;
  while ((m = ext.pattern.exec(content)) !== null) {
    const node = ext.render(m);
    if (node !== null && node !== undefined) {
      const before = content.slice(lastIndex, m.index);
      if (before.trim()) segments.push({ kind: "text", text: before });
      segments.push({ kind: "addon", node });
      lastIndex = ext.pattern.lastIndex;
    }
  }
  const rest = content.slice(lastIndex);
  if (rest.trim() || segments.length === 0) segments.push({ kind: "text", text: rest });
  return segments;
}

function splitSegments(content: string): (AddonBlockSegment | TextSegment)[] {
  let segments: (AddonBlockSegment | TextSegment)[] = [{ kind: "text", text: content }];
  for (const ext of BLOCK_EXTENSIONS) {
    segments = segments.flatMap((seg) => (seg.kind === "text" ? splitByExtension(seg.text, ext) : [seg]));
  }
  return segments;
}

/** add-on 이 지정한 안내 마커를 텍스트에서 지운다 — 모델이 그대로 옮겨도 표시되지 않게. */
function stripAddonMarkers(text: string): string {
  let out = text;
  for (const ext of BLOCK_EXTENSIONS) if (ext.stripFromText) out = out.replace(ext.stripFromText, "");
  return out;
}

function MarkdownText({ text, sources }: { text: string; sources?: SearchSourceRef[] }) {
  // 인용 [N] → 칩(F19.4): 출처가 있을 때만 전처리하고 a override 가 #cite-N 을 칩으로 렌더한다
  const components = useMemo<Components>(() => {
    if (!sources?.length) return MD_COMPONENTS;
    return {
      ...MD_COMPONENTS,
      a: (props: LinkProps) => {
        const n = citationNumber(typeof props.href === "string" ? props.href : undefined);
        if (n !== null) return <CitationChip n={n} source={sources[n - 1]} />;
        return <MarkdownLink {...props} />;
      },
    };
  }, [sources]);
  const cleaned = stripAddonMarkers(text).trimEnd();
  if (!cleaned) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={components}
    >
      {sources?.length ? linkCitations(cleaned, sources.length) : cleaned}
    </ReactMarkdown>
  );
}

/** reportdata 블록 표시 — 스트리밍 중엔 진행 칩, 잔존(렌더 실패 fail-open)은 접힌 JSON. */
function ReportDataBlock({ seg }: { seg: ReportSegment }) {
  const t = useTranslations("chat");
  if (seg.streaming) {
    return (
      <div className="my-2 inline-flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
        📊 {t("reportBuilding")}
      </div>
    );
  }
  return (
    <details className="my-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
      <summary className="cursor-pointer select-none text-muted">📊 {t("reportData")}</summary>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">
        {seg.json}
      </pre>
    </details>
  );
}

export function Markdown({ content, sources }: { content: string; sources?: SearchSourceRef[] }) {
  const reportSegments = splitReportSegments(content);
  return (
    <div className="prose-chat break-words">
      {reportSegments.map((rseg, ri) => (
        <Fragment key={ri}>
          {rseg.kind === "report" ? (
            <ReportDataBlock seg={rseg} />
          ) : (
            splitSegments(rseg.text).map((seg, i) => (
              <Fragment key={i}>
                {seg.kind === "addon" ? (
                  seg.node
                ) : (
                  <MarkdownText text={seg.text} sources={sources} />
                )}
              </Fragment>
            ))
          )}
        </Fragment>
      ))}
    </div>
  );
}
