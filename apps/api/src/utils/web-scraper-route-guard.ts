/**
 * Playwright 요청 가드 — 스크래퍼 브라우저의 모든 요청(문서·하위 리소스·리다이렉트)을 SSRF 가드로 검사한다(W3 S6).
 *
 * 판정은 재사용하지 않고 요청마다 검증한다 — 같은 origin 이라도 앞 판정이 뒤 요청에 그대로 쓰이지 않게 한다
 * (2026-11-08 점검 후속 보강). 하위 리소스가 많으면 DNS 조회가 늘어나는 것은 감수한다.
 *
 * @module utils/web-scraper-route-guard
 */

/** validate 가 통과하면 true, 던지면 false 를 돌려주는 가드. 요청마다 validate 를 부른다. */
export function createRouteGuard(validate: (url: string) => Promise<unknown>): (url: string) => Promise<boolean> {
    return (url: string) => {
        if (!URL.canParse(url)) return Promise.resolve(false);
        return validate(url).then(() => true, () => false);
    };
}
