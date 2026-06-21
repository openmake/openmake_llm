"use client";

import { useEffect, useMemo, useState } from "react";
import { Library, Plus, Package, Upload } from "lucide-react";
import {
  Button,
  Badge,
  PageHeader,
  Card,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ApiSuccess } from "@openmake/shared-types";
import { ApiClient } from "@/lib/api-client";

/* ── 카테고리 라벨 (apps/legacy-web skill-library.js CATEGORY_LABELS 미러) ── */
const CATEGORY_LABELS: Record<string, string> = {
  productivity: "생산성",
  technology: "기술/IT",
  creative: "창작/디자인",
  business: "비즈니스",
  science: "과학/연구",
  communication: "커뮤니케이션",
  finance: "금융/투자",
  education: "교육/학습",
};

/* ── 타입 ────────────────────────────────────────────────── */
interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  isSystem: boolean;
}

/* ── 백엔드 응답 타입 (GET /api/agents/skills → res.data = SkillSearchResult) ── */
interface ApiSkill {
  id: string;
  name: string;
  description: string;
  category: string;
  createdBy?: string | null;
}

type SkillsResponse = ApiSuccess<{
  skills: ApiSkill[];
  total: number;
  limit: number;
  offset: number;
}>;

function mapSkill(s: ApiSkill): Skill {
  return {
    id: s.id,
    name: s.name,
    category: s.category || "general",
    description: s.description || "",
    // 시스템 스킬 = createdBy 없음(null), 사용자 스킬 = createdBy 존재
    isSystem: !s.createdBy,
  };
}

/* ── 목업 데이터 — 미인증/네트워크 실패 시 폴백 ─────────────── */
const SKILLS: Skill[] = [
  {
    id: "s1",
    name: "PDF 요약",
    category: "productivity",
    description: "긴 PDF 문서를 핵심 요점으로 압축합니다.",
    isSystem: true,
  },
  {
    id: "s2",
    name: "SQL 쿼리 작성",
    category: "technology",
    description: "자연어 요구사항을 파라미터화된 SQL 로 변환합니다.",
    isSystem: true,
  },
  {
    id: "s3",
    name: "광고 카피라이팅",
    category: "creative",
    description: "타겟 세그먼트에 맞춘 마케팅 카피를 생성합니다.",
    isSystem: false,
  },
  {
    id: "s4",
    name: "재무 보고서 해석",
    category: "finance",
    description: "손익계산서와 대차대조표의 핵심 지표를 해석합니다.",
    isSystem: false,
  },
  {
    id: "s5",
    name: "논문 리뷰",
    category: "science",
    description: "학술 논문의 방법론과 한계를 비판적으로 검토합니다.",
    isSystem: true,
  },
  {
    id: "s6",
    name: "이메일 초안 작성",
    category: "communication",
    description: "상황과 톤에 맞는 비즈니스 이메일을 작성합니다.",
    isSystem: false,
  },
  {
    id: "s7",
    name: "회의록 정리",
    category: "productivity",
    description: "대화 기록을 구조화된 회의록과 액션 아이템으로 정리합니다.",
    isSystem: false,
  },
  {
    id: "s8",
    name: "코드 리팩터링 제안",
    category: "technology",
    description: "코드의 단순화·재사용 기회를 식별해 제안합니다.",
    isSystem: true,
  },
];

const ALL = "all";

function categoryLabel(id: string) {
  return CATEGORY_LABELS[id] || id || "일반";
}

export default function SkillLibraryPage() {
  const [skills, setSkills] = useState<Skill[]>(SKILLS);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<string>(ALL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await ApiClient.get<SkillsResponse>(
          "/api/agents/skills?limit=200",
        );
        if (cancelled) return;
        setSkills((res?.data?.skills ?? []).map(mapSkill));
      } catch {
        // 401·네트워크 실패: 목업 폴백 유지
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skills) counts.set(s.category, (counts.get(s.category) || 0) + 1);
    return Array.from(counts.entries()).map(([id, count]) => ({
      id,
      label: categoryLabel(id),
      count,
    }));
  }, [skills]);

  const filtered =
    active === ALL ? skills : skills.filter((s) => s.category === active);

  return (
    <>
      <PageHeader
        title="스킬 라이브러리"
        description="재사용 가능한 매니페스트와 도구 바인딩을 관리합니다."
        actions={
          <>
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4" />
              .SKILL 업로드
            </Button>
            <Button size="sm">
              <Plus className="h-4 w-4" />새 스킬
            </Button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* 카테고리 필터 */}
        <div className="mb-5 flex flex-wrap gap-2">
          <FilterChip
            label="전체"
            count={skills.length}
            active={active === ALL}
            onClick={() => setActive(ALL)}
          />
          {categories.map((c) => (
            <FilterChip
              key={c.id}
              label={c.label}
              count={c.count}
              active={active === c.id}
              onClick={() => setActive(c.id)}
            />
          ))}
        </div>

        {loading ? (
          <div className="grid place-items-center py-24 text-center">
            <Library className="mb-3 h-8 w-8 animate-pulse text-faint" />
            <p className="text-sm text-muted">불러오는 중...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center py-24 text-center">
            <Library className="mb-3 h-8 w-8 text-faint" />
            <p className="text-sm font-medium text-fg-2">스킬이 없습니다</p>
            <p className="mt-1 text-sm text-muted">
              다른 카테고리를 선택하거나 새 스킬을 추가하세요.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((s) => (
              <Card key={s.id} className="flex flex-col p-5">
                <div className="mb-3 flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-md bg-accent-soft text-accent">
                    <Package className="h-4 w-4" />
                  </div>
                  <Badge tone="neutral">{categoryLabel(s.category)}</Badge>
                  {s.isSystem ? (
                    <Badge tone="accent">시스템</Badge>
                  ) : (
                    <Badge tone="neutral">사용자</Badge>
                  )}
                </div>
                <h3 className="mb-1 text-sm font-semibold text-fg">{s.name}</h3>
                <p className="line-clamp-2 text-xs leading-relaxed text-muted">
                  {s.description}
                </p>
              </Card>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium transition",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface text-fg-2 hover:bg-surface-2",
      )}
    >
      {label}
      <span
        className={cn(
          "font-mono",
          active ? "text-accent" : "text-faint",
        )}
      >
        {count}
      </span>
    </button>
  );
}
