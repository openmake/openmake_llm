import { ApiClient } from "@/lib/api-client";

/** /api/agents/skills 의 스킬 1건 (메뉴 표시에 필요한 필드만 사용). */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface SkillSearchResponse {
  skills: SkillSummary[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * 스킬 이름 → slash 명령 slug.
 * 백엔드 `chat/slash-command.ts` 의 slugify 와 정확히 동일해야 매칭된다.
 * (소문자, 연속 비영숫자 → '-', 양끝 '-' 제거)
 */
export function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * GET /api/agents/skills — active 스킬 검색/목록 (슬래시 드롭다운용).
 * `{ success, data: { skills, ... } }` 응답을 언래핑해 스킬 배열만 반환한다.
 *
 * - 검색어 없음("/" 단독): 카테고리 그룹핑을 위해 전체(최대 200)를 가져온다.
 * - 검색어 있음: 평면 필터 목록이므로 30개로 제한.
 */
export async function fetchSkills(search?: string): Promise<SkillSummary[]> {
  const limit = search ? "30" : "200";
  const params = new URLSearchParams({ sortBy: "name", limit });
  if (search) params.set("search", search);
  const res = await ApiClient.get<{ success: boolean; data: SkillSearchResponse }>(
    `/api/agents/skills?${params.toString()}`,
  );
  return res?.data?.skills ?? [];
}

/** 카테고리 표시 라벨 — 빈 값은 '기타'로 대체. */
export function skillCategoryLabel(category: string): string {
  return category && category.trim() ? category : "기타";
}

/**
 * 스킬을 카테고리로 그룹핑해 평탄화한 단일 순서를 반환한다.
 * 키보드 네비게이션 인덱스와 그룹 렌더 순서를 일치시키기 위해, 호출자는
 * 반환된 `ordered` 배열(카테고리별로 인접 정렬)을 단일 진실로 사용한다.
 * 렌더 측은 category 가 바뀌는 지점마다 헤더를 삽입하면 된다.
 */
export function groupSkillsByCategory(skills: SkillSummary[]): SkillSummary[] {
  const byCat = new Map<string, SkillSummary[]>();
  for (const s of skills) {
    const label = skillCategoryLabel(s.category);
    const arr = byCat.get(label);
    if (arr) arr.push(s);
    else byCat.set(label, [s]);
  }
  const ordered: SkillSummary[] = [];
  for (const label of [...byCat.keys()].sort((a, b) => a.localeCompare(b))) {
    const arr = byCat.get(label)!;
    arr.sort((a, b) => a.name.localeCompare(b.name));
    ordered.push(...arr);
  }
  return ordered;
}
