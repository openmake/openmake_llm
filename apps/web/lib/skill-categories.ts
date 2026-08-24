/**
 * 스킬 카테고리 라벨 키 — 스킬 라이브러리와 승인 화면이 공유한다.
 *
 * @module lib/skill-categories
 */
export const CATEGORY_KEYS: Record<string, string> = {
  productivity: "categories.productivity",
  technology: "categories.technology",
  creative: "categories.creative",
  business: "categories.business",
  science: "categories.science",
  communication: "categories.communication",
  finance: "categories.finance",
  education: "categories.education",
};

export type Translate = (key: string) => string;
