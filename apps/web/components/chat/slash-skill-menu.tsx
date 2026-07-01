"use client";

import { Fragment, useEffect, useRef } from "react";
import { Sparkles, ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { skillCategoryLabel, skillSlug, type SkillSummary } from "@/lib/skills-api";

interface SlashSkillMenuProps {
  /** 표시할 스킬 목록 (검색 시 평면 / 미검색 시 카테고리순 정렬된 단일 배열) */
  skills: SkillSummary[];
  /** 카테고리 헤더 그룹핑 여부 (검색어 없을 때 true) */
  grouped: boolean;
  /** 키보드 네비게이션 활성 인덱스. skills.length === "전체 보기" 항목. */
  activeIndex: number;
  /** 검색 로딩 중 여부 */
  loading: boolean;
  /** 항목 클릭/Enter 선택 */
  onSelect: (skill: SkillSummary) => void;
  /** 마우스 hover 로 활성 인덱스 변경 */
  onHover: (index: number) => void;
  /** "전체 보기" 활성화 (스킬 라이브러리 이동) */
  onViewAll: () => void;
}

/**
 * 채팅 입력창 슬래시(/) 스킬 호출 드롭다운.
 * 컴포저 위로 떠오르는 패널(모드 시트와 동일 스타일)로, 선택 시 텍스트를
 * `/<slug> ` 로 채워 백엔드 slash-command 매칭을 유도한다.
 *
 * - 미검색: `grouped` true — category 가 바뀌는 지점마다 헤더 삽입(부모가 카테고리순 정렬해 전달).
 * - 검색: 평면 목록.
 * 키보드 네비게이션/Enter 충돌 처리는 부모(Composer)가 담당하며, activeIndex 는
 * skills 배열 인덱스(0..n-1) 와 "전체 보기"(n) 를 단일 진실로 가리킨다.
 */
export function SlashSkillMenu({
  skills,
  grouped,
  activeIndex,
  loading,
  onSelect,
  onHover,
  onViewAll,
}: SlashSkillMenuProps) {
  const t = useTranslations("composer");
  const listRef = useRef<HTMLDivElement>(null);
  const viewAllIndex = skills.length;

  // 활성 항목이 보이도록 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  let prevCategory: string | null = null;

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2 flex flex-col overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg">
      <p className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        {t("slashMenu.heading")}
      </p>

      {skills.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          {loading ? t("slashMenu.loading") : t("slashMenu.noResults")}
        </p>
      ) : (
        <div ref={listRef} className="max-h-72 overflow-y-auto p-1">
          {skills.map((skill, i) => {
            const cat = skillCategoryLabel(skill.category) || t("slashMenu.categoryEtc");
            const showHeader = grouped && cat !== prevCategory;
            prevCategory = cat;
            return (
              <Fragment key={skill.id}>
                {showHeader && (
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
                    {cat}
                  </p>
                )}
                <button
                  type="button"
                  data-idx={i}
                  // 마우스다운(blur 전)에 선택 — 텍스트영역 포커스 유지
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelect(skill);
                  }}
                  onMouseEnter={() => onHover(i)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition",
                    i === activeIndex ? "bg-surface-3" : "hover:bg-surface-3",
                  )}
                >
                  <Sparkles
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      i === activeIndex ? "text-accent" : "text-muted",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-sm font-medium text-fg">{skill.name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">
                        /{skillSlug(skill.name)}
                      </span>
                    </span>
                    {skill.description && (
                      <span className="mt-0.5 block truncate text-xs text-muted">
                        {skill.description}
                      </span>
                    )}
                  </span>
                </button>
              </Fragment>
            );
          })}
        </div>
      )}

      {/* 전체 보기 — 스킬 라이브러리로 이동 (키보드 순회 마지막 인덱스) */}
      <button
        type="button"
        data-idx={viewAllIndex}
        onMouseDown={(e) => {
          e.preventDefault();
          onViewAll();
        }}
        onMouseEnter={() => onHover(viewAllIndex)}
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2 text-left text-xs font-medium transition",
          activeIndex === viewAllIndex ? "bg-surface-3 text-fg" : "text-muted hover:bg-surface-3 hover:text-fg",
        )}
      >
        <span>{t("slashMenu.viewAll")}</span>
        <ArrowRight className="h-3.5 w-3.5 shrink-0" />
      </button>
    </div>
  );
}
