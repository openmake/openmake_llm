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
 */
export async function fetchSkills(search?: string): Promise<SkillSummary[]> {
  const params = new URLSearchParams({ sortBy: "name", limit: "20" });
  if (search) params.set("search", search);
  const res = await ApiClient.get<{ success: boolean; data: SkillSearchResponse }>(
    `/api/agents/skills?${params.toString()}`,
  );
  return res?.data?.skills ?? [];
}
