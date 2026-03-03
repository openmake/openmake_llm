/**
 * ============================================================
 * Search Locale — 언어별 검색 API 파라미터 매핑
 * ============================================================
 *
 * 웹 검색 (Google, Wikipedia, Google News, Firecrawl) 시
 * 사용자 언어에 맞는 지역/언어 파라미터를 제공합니다.
 *
 * @module i18n/search-locale
 */

/**
 * 검색 API에 필요한 지역화 파라미터
 */
export interface SearchLocaleParams {
    /** Firecrawl/일반 검색 언어 코드 (예: 'ko', 'en') */
    lang: string;
    /** Firecrawl/일반 검색 국가 코드 (예: 'kr', 'us') */
    country: string;
    /** Google Custom Search 추가 파라미터 (예: '&gl=kr&lr=lang_ko') */
    googleParams: string;
    /** Wikipedia 도메인 접두사 (예: 'ko', 'en', 'ja') */
    wikiDomain: string;
    /** Google News RSS 파라미터 (예: 'hl=ko&gl=KR&ceid=KR:ko') */
    newsParams: string;
    /** BCP-47 로케일 (예: 'ko-KR', 'en-US') — 날짜 포맷용 */
    bcp47Locale: string;
}

/**
 * 언어 코드별 검색 로케일 매핑.
 * 미지원 언어는 getSearchLocale()에서 'en' 폴백.
 */
const SEARCH_LOCALE_MAP: Record<string, SearchLocaleParams> = {
    ko: { lang: 'ko', country: 'kr', googleParams: '&gl=kr&lr=lang_ko', wikiDomain: 'ko', newsParams: 'hl=ko&gl=KR&ceid=KR:ko', bcp47Locale: 'ko-KR' },
    en: { lang: 'en', country: 'us', googleParams: '', wikiDomain: 'en', newsParams: 'hl=en&gl=US&ceid=US:en', bcp47Locale: 'en-US' },
    ja: { lang: 'ja', country: 'jp', googleParams: '&gl=jp&lr=lang_ja', wikiDomain: 'ja', newsParams: 'hl=ja&gl=JP&ceid=JP:ja', bcp47Locale: 'ja-JP' },
    zh: { lang: 'zh', country: 'cn', googleParams: '&gl=cn&lr=lang_zh-CN', wikiDomain: 'zh', newsParams: 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans', bcp47Locale: 'zh-CN' },
    es: { lang: 'es', country: 'es', googleParams: '&gl=es&lr=lang_es', wikiDomain: 'es', newsParams: 'hl=es&gl=ES&ceid=ES:es', bcp47Locale: 'es-ES' },
    de: { lang: 'de', country: 'de', googleParams: '&gl=de&lr=lang_de', wikiDomain: 'de', newsParams: 'hl=de&gl=DE&ceid=DE:de', bcp47Locale: 'de-DE' },
    fr: { lang: 'fr', country: 'fr', googleParams: '&gl=fr&lr=lang_fr', wikiDomain: 'fr', newsParams: 'hl=fr&gl=FR&ceid=FR:fr', bcp47Locale: 'fr-FR' },
    pt: { lang: 'pt', country: 'br', googleParams: '&gl=br&lr=lang_pt', wikiDomain: 'pt', newsParams: 'hl=pt-BR&gl=BR&ceid=BR:pt-419', bcp47Locale: 'pt-BR' },
    ru: { lang: 'ru', country: 'ru', googleParams: '&gl=ru&lr=lang_ru', wikiDomain: 'ru', newsParams: 'hl=ru&gl=RU&ceid=RU:ru', bcp47Locale: 'ru-RU' },
    ar: { lang: 'ar', country: 'sa', googleParams: '&gl=sa&lr=lang_ar', wikiDomain: 'ar', newsParams: 'hl=ar&gl=SA&ceid=SA:ar', bcp47Locale: 'ar-SA' },
    hi: { lang: 'hi', country: 'in', googleParams: '&gl=in&lr=lang_hi', wikiDomain: 'hi', newsParams: 'hl=hi&gl=IN&ceid=IN:hi', bcp47Locale: 'hi-IN' },
    it: { lang: 'it', country: 'it', googleParams: '&gl=it&lr=lang_it', wikiDomain: 'it', newsParams: 'hl=it&gl=IT&ceid=IT:it', bcp47Locale: 'it-IT' },
    nl: { lang: 'nl', country: 'nl', googleParams: '&gl=nl&lr=lang_nl', wikiDomain: 'nl', newsParams: 'hl=nl&gl=NL&ceid=NL:nl', bcp47Locale: 'nl-NL' },
    sv: { lang: 'sv', country: 'se', googleParams: '&gl=se&lr=lang_sv', wikiDomain: 'sv', newsParams: 'hl=sv&gl=SE&ceid=SE:sv', bcp47Locale: 'sv-SE' },
    da: { lang: 'da', country: 'dk', googleParams: '&gl=dk&lr=lang_da', wikiDomain: 'da', newsParams: 'hl=da&gl=DK&ceid=DK:da', bcp47Locale: 'da-DK' },
    no: { lang: 'no', country: 'no', googleParams: '&gl=no&lr=lang_no', wikiDomain: 'no', newsParams: 'hl=no&gl=NO&ceid=NO:no', bcp47Locale: 'nb-NO' },
    fi: { lang: 'fi', country: 'fi', googleParams: '&gl=fi&lr=lang_fi', wikiDomain: 'fi', newsParams: 'hl=fi&gl=FI&ceid=FI:fi', bcp47Locale: 'fi-FI' },
    th: { lang: 'th', country: 'th', googleParams: '&gl=th&lr=lang_th', wikiDomain: 'th', newsParams: 'hl=th&gl=TH&ceid=TH:th', bcp47Locale: 'th-TH' },
    vi: { lang: 'vi', country: 'vn', googleParams: '&gl=vn&lr=lang_vi', wikiDomain: 'vi', newsParams: 'hl=vi&gl=VN&ceid=VN:vi', bcp47Locale: 'vi-VN' },
    tr: { lang: 'tr', country: 'tr', googleParams: '&gl=tr&lr=lang_tr', wikiDomain: 'tr', newsParams: 'hl=tr&gl=TR&ceid=TR:tr', bcp47Locale: 'tr-TR' }
};

/**
 * 언어 코드에 대한 검색 로케일 파라미터를 반환합니다.
 * 미지원 언어는 영어('en')로 폴백합니다.
 *
 * @param language - ISO 639-1 언어 코드
 * @returns 해당 언어의 검색 로케일 파라미터
 */
export function getSearchLocale(language: string): SearchLocaleParams {
    return SEARCH_LOCALE_MAP[language] || SEARCH_LOCALE_MAP['en']!;
}
