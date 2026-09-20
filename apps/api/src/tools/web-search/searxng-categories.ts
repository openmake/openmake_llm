/**
 * @module tools/web-search/searxng-categories
 */
import { SEARXNG_CATEGORY_SCOPE } from '../../config/runtime-limits';

/**
 * 질의 성격에 맞는 SearXNG 카테고리를 결정한다 (결정적 regex — LLM 판단 아님).
 * 기술/학술 패턴 매칭 시 `it`/`science` 를 general 에 추가해 github·arxiv 등 권위 소스를 유입시킨다.
 * 비매칭 시 undefined (기본 general — 기존 동작 무변경).
 */
export function detectSearxngCategories(query: string): string | undefined {
    const it = SEARXNG_CATEGORY_SCOPE.IT_PATTERN.test(query);
    const science = SEARXNG_CATEGORY_SCOPE.SCIENCE_PATTERN.test(query);
    if (it && science) return 'general,it,science';
    if (it) return 'general,it';
    if (science) return 'general,science';
    return undefined;
}
