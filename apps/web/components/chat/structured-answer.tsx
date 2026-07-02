"use client";

import { AlertTriangle, CheckCircle2, ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import type { StructuredAnswerData } from "@/lib/store";
import { Markdown } from "./markdown";
import { cn } from "@/lib/utils";

const CONFIDENCE_KEY: Record<StructuredAnswerData["confidence"], string> = {
  high: "structured.confidence.high",
  medium: "structured.confidence.medium",
  low: "structured.confidence.low",
};

const CONFIDENCE_STYLE: Record<StructuredAnswerData["confidence"], string> = {
  high: "border-accent bg-accent-soft text-accent",
  medium: "border-border bg-surface-2 text-fg-2",
  low: "border-border bg-surface-2 text-muted",
};

/** 구조화 표(headers/rows) → GFM 스타일 네이티브 테이블. */
function StructuredTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="border border-border bg-surface-2 px-3 py-1.5 text-left font-semibold text-fg"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td key={ci} className="border border-border px-3 py-1.5 align-top text-fg-2">
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 구조화 답변 카드 렌더러 — structuredMode(REST /api/chat/structured) 응답 전용.
 * 결론을 먼저, 그 다음 요약·섹션(+표)·주의할 점·다음 실행 순으로 항상 일정한 구조로 표시한다.
 */
export function StructuredAnswer({ data }: { data: StructuredAnswerData }) {
  const t = useTranslations("chat");
  // 백엔드가 스키마를 어겨 필드가 누락돼도 렌더 크래시(→ MessageList 전체 사망)를 막는다.
  const confidence = data.confidence in CONFIDENCE_STYLE ? data.confidence : "medium";
  const sections = data.sections ?? [];
  return (
    <div className="space-y-3">
      {/* 제목 + confidence 배지 */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-fg">{data.title}</h3>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
            CONFIDENCE_STYLE[confidence],
          )}
        >
          {t(CONFIDENCE_KEY[confidence])}
        </span>
      </div>

      {/* 결론 — 강조 카드 (가장 먼저) */}
      <div className="rounded-lg border border-accent bg-accent-soft px-3.5 py-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">{t("structured.conclusion")}</p>
        <div className="text-sm leading-relaxed text-fg">
          <Markdown content={data.conclusion} />
        </div>
      </div>

      {/* 요약 */}
      {data.summary?.trim() ? (
        <div className="text-sm leading-relaxed text-fg-2">
          <Markdown content={data.summary} />
        </div>
      ) : null}

      {/* 본문 섹션 */}
      {sections.map((s, i) => (
        <section key={i} className="space-y-1.5">
          <h4 className="text-sm font-semibold text-fg">{s.heading}</h4>
          {s.body?.trim() ? (
            <div className="text-sm leading-relaxed text-fg-2">
              <Markdown content={s.body} />
            </div>
          ) : null}
          {s.bullets?.length ? (
            <ul className="ml-4 list-disc space-y-0.5 text-sm text-fg-2 marker:text-accent">
              {s.bullets.map((b, bi) => (
                <li key={bi}>{b}</li>
              ))}
            </ul>
          ) : null}
          {s.table?.headers?.length ? (
            <StructuredTable headers={s.table.headers} rows={s.table.rows ?? []} />
          ) : null}
        </section>
      ))}

      {/* 주의할 점 */}
      {data.risks?.length ? (
        <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> {t("structured.risks")}
          </p>
          <ul className="ml-4 list-disc space-y-0.5 text-sm text-fg-2 marker:text-amber-500">
            {data.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 다음 실행 */}
      {data.action_items?.length ? (
        <div className="rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-2">
            <ListChecks className="h-3.5 w-3.5 text-accent" /> {t("structured.actionItems")}
          </p>
          <ul className="space-y-1 text-sm text-fg-2">
            {data.action_items.map((a, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
