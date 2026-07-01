import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type Locale } from "./config";

/** NEXT_LOCALE 쿠키 → Accept-Language 협상 → 기본(ko) 순으로 locale 을 결정한다. */
async function resolveLocale(): Promise<Locale> {
  const store = await cookies();
  const fromCookie = store.get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  // 쿠키 없음 = "자동 감지" — Accept-Language 의 primary subtag 를 순서대로 매칭.
  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  for (const part of acceptLanguage.split(",")) {
    const lang = part.split(";")[0]?.trim().slice(0, 2).toLowerCase();
    if (isLocale(lang)) return lang;
  }
  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
