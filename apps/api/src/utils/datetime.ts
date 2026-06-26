/**
 * 날짜/시간 유틸 — 앱 타임존 기준 현재 날짜.
 *
 * `new Date().toISOString()` 은 UTC 라, KST(UTC+9) 사용자에게 자정~오전 9시 사이에는
 * 전날(연초엔 전년) 날짜를 주입해 "현재가 2024년" 류의 stale-year 오인식을 유발한다.
 * 앱 타임존(APP_TIMEZONE, 기본 Asia/Seoul) 기준으로 YYYY-MM-DD 를 산출해 이를 방지한다.
 *
 * @module utils/datetime
 */

/** 앱 기준 타임존 (IANA). 배포 지역에 맞춰 APP_TIMEZONE 으로 오버라이드. */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Seoul';

/**
 * 지정 타임존(기본 APP_TIMEZONE) 기준 현재 날짜를 YYYY-MM-DD 로 반환.
 * en-CA 로케일은 ISO 8601 형식(YYYY-MM-DD)을 보장한다.
 */
export function getCurrentDate(timeZone: string = APP_TIMEZONE): string {
    return new Date().toLocaleDateString('en-CA', { timeZone });
}
