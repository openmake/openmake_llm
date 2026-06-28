"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { skillSlug, type SkillSummary } from "@/lib/skills-api";

interface SlashSkillMenuProps {
  /** 표시할 스킬 목록 (이미 검색 필터링된 결과) */
  skills: SkillSummary[];
  /** 키보드 네비게이션 활성 인덱스 */
  activeIndex: number;
  /** 검색 로딩 중 여부 */
  loading: boolean;
  /** 항목 클릭/Enter 선택 */
  onSelect: (skill: SkillSummary) => void;
  /** 마우스 hover 로 활성 인덱스 변경 */
  onHover: (index: number) => void;
}

/**
 * 채팅 입력창 슬래시(/) 스킬 호출 드롭다운.
 * 컴포저 위로 떠오르는 패널(모드 시트와 동일 스타일)로, 선택 시 텍스트를
 * `/<slug> ` 로 채워 백엔드 slash-command 매칭을 유도한다.
 * 키보드 네비게이션/Enter 충돌 처리는 부모(Composer)가 담당한다.
 */
export function SlashSkillMenu({
  skills,
  activeIndex,
  loading,
  onSelect,
  onHover,
}: SlashSkillMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // 활성 항목이 보이도록 스크롤
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-xl border border-border bg-surface-2 shadow-lg">
      <p className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
        스킬 호출
      </p>
      {skills.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          {loading ? "스킬을 불러오는 중…" : "일치하는 스킬이 없습니다"}
        </p>
      ) : (
        <div ref={listRef} className="max-h-64 overflow-y-auto p-1">
          {skills.map((skill, i) => (
            <button
              key={skill.id}
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
          ))}
        </div>
      )}
    </div>
  );
}
