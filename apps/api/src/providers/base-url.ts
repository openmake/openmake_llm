/**
 * base_url 정규화·비교 — provider-router(채팅 게이트웨이 분기)와 capability-resolver(배정·해석)가 같은 규칙을 쓴다.
 *
 * @module providers/base-url
 */
import { getProviderCatalogEntry } from '../config/external-providers';

/** base_url 비교용 정규화 — 끝 `/` 제거, scheme·host 소문자(URL 파싱 실패 시 원문 trim). */
export function normalizeBaseUrl(raw: string): string {
    const trimmed = raw.trim();
    try {
        const u = new URL(trimmed);
        return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`;
    } catch {
        return trimmed.replace(/\/+$/, '');
    }
}

/** 로그용 host 만 추출 — 경로·쿼리(키가 섞일 수 있음)는 남기지 않는다. */
export function baseUrlHost(raw: string): string {
    try {
        return new URL(raw.trim()).host;
    } catch {
        return '(invalid)';
    }
}

/** 키 행의 base_url 이 카탈로그 기본값과 다른가(사용자 지정 endpoint). 빈 값·카탈로그 기본값 없음은 false. */
export function isCustomBaseUrl(providerId: string, baseUrl: string | null | undefined): boolean {
    if (!baseUrl) return false;
    const defaultBaseUrl = getProviderCatalogEntry(providerId)?.defaultBaseUrl;
    if (!defaultBaseUrl) return false;
    return normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(defaultBaseUrl);
}
