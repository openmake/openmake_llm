"use client";

/**
 * 본문 인용 [N] 칩 + 팝오버 (F19.4) — 제목·도메인·스니펫·원문 링크. 포커스를 옮기지 않는 경량 팝오버라
 * Escape·바깥 클릭으로 닫는다. 터치(pointer:coarse)도 탭으로 열고 닫는다.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";
import type { SearchSourceRef } from "@openmake/shared-types";
import { sourceDomain } from "@/lib/citations";

export function CitationChip({ n, source }: { n: number; source?: SearchSourceRef }) {
  const t = useTranslations("chat.citation");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const popoverId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!source) return <span className="text-muted">[{n}]</span>;
  const domain = sourceDomain(source);
  return (
    <span ref={wrapRef} className="relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={t("chipLabel", { n, title: source.title })}
        className="mx-0.5 inline-flex h-[1.35em] min-w-[1.35em] items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[0.72em] leading-none text-fg-2 hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        {n}
      </button>
      {open && (
        <span
          id={popoverId}
          role="dialog"
          aria-label={t("popoverLabel", { n })}
          className="absolute left-0 top-full z-30 mt-1 block w-72 max-w-[80vw] rounded-lg border border-border bg-surface p-3 text-left text-sm shadow-lg"
        >
          <span className="block font-medium leading-snug text-fg">{source.title}</span>
          <span className="mt-0.5 block truncate font-mono text-xs text-muted">{domain}</span>
          {source.snippet && <span className="mt-2 block text-xs leading-relaxed text-fg-2">{source.snippet}</span>}
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-accent underline underline-offset-2 hover:text-accent-hover"
          >
            <ExternalLink className="h-3 w-3" aria-hidden /> {t("open")}
          </a>
        </span>
      )}
    </span>
  );
}
