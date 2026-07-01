/**
 * i18n 공통 상수 — 서버/클라이언트 양쪽에서 import 가능 (next/headers 의존 금지).
 * locale SoT 는 NEXT_LOCALE 쿠키 하나: 서버(i18n/request.ts)가 읽어 렌더하고,
 * 클라이언트(설정 페이지)가 쓴 뒤 router.refresh() 로 재렌더한다.
 * 쿠키 없음 = "자동 감지" (Accept-Language 협상 → DEFAULT_LOCALE 폴백).
 */
export const LOCALES = ["ko", "en", "ja", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ko";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1년

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
