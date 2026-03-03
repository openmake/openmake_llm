/**
 * ============================================================
 * i18n — 중앙 다국어 관리 모듈
 * ============================================================
 *
 * 모든 프롬프트/UI/에러 메시지의 다국어 문자열을 안전하게 조회하고
 * 누락된 로케일에 대해 자동 폴백을 제공합니다.
 *
 * ## 사용법
 *
 * ```typescript
 * import { getLocaleContent, interpolate } from '../i18n';
 *
 * const labels = getLocaleContent(MY_LOCALE_MAP, locale);
 * const msg = interpolate('Loop {loop}: {count} items', { loop: 2, count: 5 });
 * ```
 *
 * @module i18n
 */

import type { PromptLocaleCode } from '../chat/language-policy';

// ============================================================
// Re-export PromptLocaleCode for convenience
// ============================================================
export type { PromptLocaleCode } from '../chat/language-policy';

// ============================================================
// Locale Content Map Type
// ============================================================

/**
 * 부분 로케일 맵 — 모든 PromptLocaleCode를 포함하지 않아도 됩니다.
 * 최소한 'en' 키만 있으면 나머지는 폴백 체인으로 해결됩니다.
 */
export type LocaleContentMap<T> = Partial<Record<PromptLocaleCode, T>> & { en: T };

// ============================================================
// Fallback Chain
// ============================================================

/**
 * 로케일 폴백 체인.
 * 요청된 로케일이 없을 경우 이 체인을 따라 순차 검색합니다.
 *
 * es → en (스페인어가 없으면 영어)
 * de → en (독일어가 없으면 영어)
 * fr → en (프랑스어가 없으면 영어)
 * ja → en
 * zh → en
 * ko → en
 */
const LOCALE_FALLBACK_CHAIN: Record<PromptLocaleCode, PromptLocaleCode[]> = {
    ko: ['ko', 'en'],
    en: ['en'],
    ja: ['ja', 'en'],
    zh: ['zh', 'en'],
    es: ['es', 'en'],
    de: ['de', 'en'],
    fr: ['fr', 'en']
};

// ============================================================
// Core API
// ============================================================

/**
 * 로케일 맵에서 안전하게 콘텐츠를 조회합니다.
 * 요청된 로케일이 없으면 폴백 체인을 따라 'en'으로 최종 폴백합니다.
 *
 * @template T - 콘텐츠 타입
 * @param map - 로케일별 콘텐츠 맵 (최소 'en' 키 필수)
 * @param locale - 요청 로케일 코드
 * @returns 해당 로케일 또는 폴백 콘텐츠
 *
 * @example
 * const LABELS = { ko: { title: '제목' }, en: { title: 'Title' }, ja: { title: 'タイトル' } };
 * getLocaleContent(LABELS, 'ja'); // { title: 'タイトル' }
 * getLocaleContent(LABELS, 'es'); // { title: 'Title' } — en fallback
 */
export function getLocaleContent<T>(map: LocaleContentMap<T>, locale: PromptLocaleCode): T {
    const chain = LOCALE_FALLBACK_CHAIN[locale] || ['en'];
    for (const candidate of chain) {
        const content = map[candidate];
        if (content !== undefined) {
            return content;
        }
    }
    // TypeScript guarantees 'en' key exists via LocaleContentMap type
    return map.en;
}

/**
 * 메시지 문자열에서 {key} 플레이스홀더를 대체합니다.
 *
 * @param template - 플레이스홀더가 포함된 템플릿 문자열
 * @param vars - 대체할 키-값 쌍
 * @returns 대체된 문자열
 *
 * @example
 * interpolate('Loop {loop}: {count} items found', { loop: 1, count: 10 });
 * // 'Loop 1: 10 items found'
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (_, key) => {
        const value = vars[key];
        return value !== undefined ? String(value) : `{${key}}`;
    });
}

/**
 * 여러 로케일 맵을 하나로 병합합니다.
 * 동일 로케일의 키가 충돌하면 뒤에 오는 맵이 우선합니다.
 *
 * @template T - 콘텐츠 타입
 * @param maps - 병합할 로케일 맵 배열
 * @returns 병합된 로케일 맵
 */
export function mergeLocaleMaps<T extends Record<string, unknown>>(
    ...maps: LocaleContentMap<Partial<T>>[]
): LocaleContentMap<T> {
    const result: Partial<Record<PromptLocaleCode, Partial<T>>> = {};

    for (const map of maps) {
        for (const [locale, content] of Object.entries(map) as [PromptLocaleCode, Partial<T>][]) {
            result[locale] = { ...(result[locale] || {}), ...content } as Partial<T>;
        }
    }

    return result as LocaleContentMap<T>;
}

/**
 * 로케일 맵의 모든 키에 대해 특정 로케일의 콘텐츠가 존재하는지 확인합니다.
 * 개발/테스트 시 번역 누락을 감지하는 데 사용합니다.
 *
 * @param map - 검사할 로케일 맵
 * @param requiredLocales - 반드시 존재해야 하는 로케일 목록
 * @returns 누락된 로케일 코드 배열 (빈 배열이면 모두 존재)
 */
export function findMissingLocales<T>(
    map: Partial<Record<PromptLocaleCode, T>>,
    requiredLocales: PromptLocaleCode[] = ['ko', 'en', 'ja', 'zh', 'es', 'de', 'fr']
): PromptLocaleCode[] {
    return requiredLocales.filter(locale => !(locale in map));
}
